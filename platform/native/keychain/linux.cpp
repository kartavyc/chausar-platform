#include "protocol.hpp"

#include <libsecret/secret.h>

#include <string>

namespace chausar::keychain {
namespace {

// Pin the already resolved unique owner of the fixed direct service and refuse
// prompting. The superclass constructor consults SECRET_SERVICE_BUS_NAME and
// overwrites supplied g-name parameters; restore the trusted construction value
// after it runs, before GInitable initializes the proxy/session.
struct CkpService { SecretService parent; };
struct CkpServiceClass { SecretServiceClass parent; };
G_DEFINE_TYPE(CkpService, ckp_service, SECRET_TYPE_SERVICE)

GVariant* refuse_prompt(SecretService*, SecretPrompt*, GCancellable*,
                       const GVariantType*, GError** error) {
  g_set_error_literal(error, G_IO_ERROR, G_IO_ERROR_PERMISSION_DENIED,
                      "Vault custody requires an already unlocked credential store");
  return nullptr;
}

// libsecret's sync item create/delete APIs internally run asynchronous requests,
// so overriding only prompt_sync would still allow a UI prompt on those paths.
void refuse_prompt_async(SecretService* self, SecretPrompt*, const GVariantType*,
                         GCancellable* cancellable, GAsyncReadyCallback callback,
                         gpointer user_data) {
  auto* task = g_task_new(self, cancellable, callback, user_data);
  g_task_return_new_error(task, G_IO_ERROR, G_IO_ERROR_PERMISSION_DENIED,
                          "Vault custody requires an already unlocked credential store");
  g_object_unref(task);
}

GVariant* refuse_prompt_finish(SecretService* self, GAsyncResult* result, GError** error) {
  if (!g_task_is_valid(result, self)) {
    g_set_error_literal(error, G_IO_ERROR, G_IO_ERROR_FAILED, "Invalid prompt completion");
    return nullptr;
  }
  return static_cast<GVariant*>(g_task_propagate_pointer(G_TASK(result), error));
}

GObject* pinned_constructor(GType type, guint count, GObjectConstructParam* properties) {
  const gchar* owner = nullptr;
  for (guint i = 0; i < count; ++i)
    if (std::strcmp(properties[i].pspec->name, "g-name") == 0)
      owner = g_value_get_string(properties[i].value);
  GObject* object = G_OBJECT_CLASS(ckp_service_parent_class)->constructor(type, count, properties);
  g_object_set(object, "g-name", owner,
                "g-flags", G_DBUS_PROXY_FLAGS_DO_NOT_AUTO_START, nullptr);
  return object;
}

void ckp_service_class_init(CkpServiceClass* klass) {
  G_OBJECT_CLASS(klass)->constructor = pinned_constructor;
  SECRET_SERVICE_CLASS(klass)->prompt_sync = refuse_prompt;
  SECRET_SERVICE_CLASS(klass)->prompt_async = refuse_prompt_async;
  SECRET_SERVICE_CLASS(klass)->prompt_finish = refuse_prompt_finish;
}

void ckp_service_init(CkpService*) {}

void discard_log(const gchar*, GLogLevelFlags, const gchar*, gpointer) {}
GLogWriterOutput discard_structured_log(GLogLevelFlags, const GLogField*, gsize, gpointer) {
  return G_LOG_WRITER_HANDLED;
}

Status native_error(const GError* error) noexcept {
  if (error == nullptr) return Status::unavailable;
  if (g_error_matches(error, SECRET_ERROR, SECRET_ERROR_IS_LOCKED) ||
      g_error_matches(error, G_IO_ERROR, G_IO_ERROR_PERMISSION_DENIED) ||
      g_error_matches(error, G_DBUS_ERROR, G_DBUS_ERROR_ACCESS_DENIED)) return Status::denied;
  if (g_error_matches(error, SECRET_ERROR, SECRET_ERROR_NO_SUCH_OBJECT)) return Status::missing;
  if (g_error_matches(error, SECRET_ERROR, SECRET_ERROR_ALREADY_EXISTS)) return Status::conflict;
  return Status::unavailable;
}

template <typename T> struct Object {
  T* value = nullptr;
  ~Object() { if (value != nullptr) g_object_unref(value); }
};
struct Error {
  GError* value = nullptr;
  ~Error() { if (value != nullptr) g_error_free(value); }
};
struct Variant {
  GVariant* value = nullptr;
  ~Variant() { if (value != nullptr) g_variant_unref(value); }
};
struct Items {
  GList* value = nullptr;
  ~Items() { g_list_free_full(value, g_object_unref); }
};
struct Attributes {
  GHashTable* value = nullptr;
  ~Attributes() { if (value != nullptr) g_hash_table_unref(value); }
};
struct Value {
  SecretValue* value = nullptr;
  ~Value() { if (value != nullptr) secret_value_unref(value); }
};

// No waiting, queued bus name or persistent resource survives helper exit.
// Session-bus ownership serializes participating helpers for the same vault.
struct VaultMutex {
  GDBusConnection* connection = nullptr;  // Borrowed from the service.
  std::string name;
  bool acquired = false;
  ~VaultMutex() {
    if (acquired) {
      Variant reply{g_dbus_connection_call_sync(connection, "org.freedesktop.DBus",
        "/org/freedesktop/DBus", "org.freedesktop.DBus", "ReleaseName",
        g_variant_new("(s)", name.c_str()), G_VARIANT_TYPE("(u)"),
        G_DBUS_CALL_FLAGS_NO_AUTO_START, 1000, nullptr, nullptr)};
    }
  }
  Status acquire(SecretService* service_proxy, const char* vault_id) {
    connection = g_dbus_proxy_get_connection(G_DBUS_PROXY(service_proxy));
    if (connection == nullptr) return Status::unavailable;
    name = "in.chausar.vault.v1.lock.v";
    for (std::size_t i = 0; i < 36; ++i) if (vault_id[i] != '-') name.push_back(vault_id[i]);
    Error error;
    Variant reply{g_dbus_connection_call_sync(connection, "org.freedesktop.DBus",
      "/org/freedesktop/DBus", "org.freedesktop.DBus", "RequestName",
      g_variant_new("(su)", name.c_str(), 4u /* DO_NOT_QUEUE */), G_VARIANT_TYPE("(u)"),
      G_DBUS_CALL_FLAGS_NO_AUTO_START, 1000, nullptr, &error.value)};
    if (reply.value == nullptr) return native_error(error.value);
    guint32 result = 0;
    g_variant_get(reply.value, "(u)", &result);
    acquired = result == 1u /* PRIMARY_OWNER */ || result == 4u /* ALREADY_OWNER */;
    return acquired ? Status::ok : Status::unavailable;
  }
};

const SecretSchema schema = {
  "in.chausar.vault.v1", SECRET_SCHEMA_NONE,
  {{"service", SECRET_SCHEMA_ATTRIBUTE_STRING},
   {"account", SECRET_SCHEMA_ATTRIBUTE_STRING}, {nullptr, SECRET_SCHEMA_ATTRIBUTE_STRING}}
};
constexpr char key_content_type[] = "application/vnd.chausar.vault-key";

Status read_key(SecretItem* item, SecureBytes<key_size>& key) {
  if (secret_item_get_locked(item)) return Status::denied;
  Error error;
  if (!secret_item_load_secret_sync(item, nullptr, &error.value)) return native_error(error.value);
  Value secret{secret_item_get_secret(item)};
  if (secret.value == nullptr) return Status::unavailable;
  gsize size = 0;
  const auto* data = reinterpret_cast<const unsigned char*>(secret_value_get(secret.value, &size));
  // The content type is written on create but not compared on read: gnome-keyring
  // (46.1, real run) returns every stored secret as text/plain, so requiring it made
  // each helper-written entry read back as a conflict. The exact schema, service and
  // account attributes plus the fixed 32-byte size identify the entry.
  if (data == nullptr || size != key_size) return Status::conflict;
  std::memcpy(key.bytes.data(), data, key_size);
  return Status::ok;
}

}  // namespace

Status execute(const Request& request, SecureBytes<key_size>& retrieved) noexcept {
  // Library diagnostics are never part of this protocol and may contain remote
  // messages. Do not forward them to stderr or serialize them into responses.
  g_log_set_default_handler(discard_log, nullptr);
  g_log_set_writer_func(discard_structured_log, nullptr, nullptr);
  try {
    // Resolve only the standard service, without activating it. Low-level
    // libsecret calls can bypass proxy flags, so all later operations target
    // this existing unique owner. A vanished owner is a failure, never a restart.
    Error bus_error;
    Object<GDBusConnection> bus{g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &bus_error.value)};
    if (bus.value == nullptr) return native_error(bus_error.value);
    Error owner_error;
    Variant owner_reply{g_dbus_connection_call_sync(bus.value, "org.freedesktop.DBus",
      "/org/freedesktop/DBus", "org.freedesktop.DBus", "GetNameOwner",
      g_variant_new("(s)", "org.freedesktop.secrets"), G_VARIANT_TYPE("(s)"),
      G_DBUS_CALL_FLAGS_NO_AUTO_START, 1000, nullptr, &owner_error.value)};
    if (owner_reply.value == nullptr) return native_error(owner_error.value);
    const gchar* owner = nullptr;
    g_variant_get(owner_reply.value, "(&s)", &owner);
    if (owner == nullptr || owner[0] != ':') return Status::unavailable;
    Error service_error;
    Object<SecretService> service_proxy{static_cast<SecretService*>(g_initable_new(ckp_service_get_type(),
      nullptr, &service_error.value, "g-name", owner,
      "flags", SECRET_SERVICE_OPEN_SESSION, nullptr))};
    if (service_proxy.value == nullptr) return native_error(service_error.value);
    const auto* proxy_name = g_dbus_proxy_get_name(G_DBUS_PROXY(service_proxy.value));
    if (proxy_name == nullptr || std::strcmp(proxy_name, owner) != 0) return Status::unavailable;
    const auto* algorithms = secret_service_get_session_algorithms(service_proxy.value);
    // Refuse libsecret's plain-session fallback before exchanging any vault key.
    if (algorithms == nullptr ||
        std::strcmp(algorithms, "dh-ietf1024-sha256-aes128-cbc-pkcs7") != 0) return Status::unavailable;
    VaultMutex mutex;
    const auto lock = mutex.acquire(service_proxy.value, request.vault_id.data());
    if (lock != Status::ok) return lock;
    Attributes attributes{g_hash_table_new_full(g_str_hash, g_str_equal, g_free, g_free)};
    g_hash_table_insert(attributes.value, g_strdup("service"), g_strdup(service));
    g_hash_table_insert(attributes.value, g_strdup("account"), g_strdup(request.vault_id.data()));
    Error search_error;
    Items items{secret_service_search_sync(service_proxy.value, &schema, attributes.value,
      SECRET_SEARCH_ALL, nullptr, &search_error.value)};
    if (search_error.value != nullptr) return native_error(search_error.value);
    if (request.operation == Operation::remove) {
      // Preflight all exact matches before deleting any; do not silently skip a
      // locked item or report success while duplicate custody entries remain.
      for (auto* node = items.value; node != nullptr; node = node->next)
        if (secret_item_get_locked(SECRET_ITEM(node->data))) return Status::denied;
      for (auto* node = items.value; node != nullptr; node = node->next) {
        Error error;
        if (!secret_item_delete_sync(SECRET_ITEM(node->data), nullptr, &error.value)) {
          const auto status = native_error(error.value);
          if (status != Status::missing) return status;
        }
      }
      return Status::ok;
    }
    if (items.value != nullptr && items.value->next != nullptr) return Status::conflict;
    SecureBytes<key_size> existing;
    const auto found = items.value == nullptr ? Status::missing :
      read_key(SECRET_ITEM(items.value->data), existing);
    if (request.operation == Operation::retrieve) {
      if (found == Status::ok)
        std::memcpy(retrieved.bytes.data(), existing.bytes.data(), key_size);
      return found;
    }
    if (found == Status::ok)
      return same_key(existing.bytes.data(), request.key.bytes.data()) ? Status::ok : Status::conflict;
    if (found != Status::missing) return found;
    Error collection_error;
    Object<SecretCollection> collection{secret_collection_for_alias_sync(service_proxy.value,
      SECRET_COLLECTION_DEFAULT, SECRET_COLLECTION_NONE, nullptr, &collection_error.value)};
    if (collection.value == nullptr) return native_error(collection_error.value);
    if (secret_collection_get_locked(collection.value)) return Status::denied;
    Value key{secret_value_new(reinterpret_cast<const gchar*>(request.key.bytes.data()),
      key_size, key_content_type)};
    if (key.value == nullptr) return Status::unavailable;
    Error create_error;
    Object<SecretItem> created{secret_item_create_sync(collection.value, &schema, attributes.value,
      "Chausar vault key", key.value, SECRET_ITEM_CREATE_NONE, nullptr, &create_error.value)};
    return created.value == nullptr ? native_error(create_error.value) : Status::ok;
  } catch (...) {
    return Status::unavailable;
  }
}

}  // namespace chausar::keychain
