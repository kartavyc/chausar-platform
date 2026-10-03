#include "protocol.hpp"

#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>

namespace chausar::keychain {
namespace {

template <typename T> struct Owned {
  T value = nullptr;
  ~Owned() { if (value != nullptr) CFRelease(value); }
};

Status native_error(OSStatus error) noexcept {
  if (error == errSecSuccess) return Status::ok;
  if (error == errSecItemNotFound) return Status::missing;
  if (error == errSecDuplicateItem) return Status::conflict;
  if (error == errSecAuthFailed || error == errSecInteractionNotAllowed ||
      error == errSecUserCanceled) return Status::denied;
  return Status::unavailable;
}

CFMutableDictionaryRef query(CFStringRef account) {
  const auto dictionary = CFDictionaryCreateMutable(kCFAllocatorDefault, 0,
    &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  if (dictionary == nullptr) return nullptr;
  CFDictionarySetValue(dictionary, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(dictionary, kSecAttrService, CFSTR("in.chausar.vault.v1"));
  CFDictionarySetValue(dictionary, kSecAttrAccount, account);
  CFDictionarySetValue(dictionary, kSecAttrSynchronizable, kCFBooleanFalse);
  // Background convenience custody never requests a new access grant or an
  // unlock prompt. The signed helper identity/ACL still requires qualification.
  CFDictionarySetValue(dictionary, kSecUseAuthenticationUI, kSecUseAuthenticationUIFail);
  return dictionary;
}

Status read_key(CFStringRef account, SecureBytes<key_size>& key) {
  Owned<CFMutableDictionaryRef> search{query(account)};
  if (search.value == nullptr) return Status::unavailable;
  CFDictionarySetValue(search.value, kSecReturnData, kCFBooleanTrue);
  CFDictionarySetValue(search.value, kSecMatchLimit, kSecMatchLimitAll);
  Owned<CFTypeRef> result;
  const auto status = native_error(SecItemCopyMatching(search.value, &result.value));
  if (status != Status::ok) return status;
  if (result.value == nullptr || CFGetTypeID(result.value) != CFArrayGetTypeID() ||
      CFArrayGetCount(static_cast<CFArrayRef>(result.value)) != 1) return Status::conflict;
  const auto data = static_cast<CFDataRef>(CFArrayGetValueAtIndex(static_cast<CFArrayRef>(result.value), 0));
  if (data == nullptr || CFGetTypeID(data) != CFDataGetTypeID() ||
      CFDataGetLength(data) != key_size) return Status::conflict;
  std::memcpy(key.bytes.data(), CFDataGetBytePtr(data), key_size);
  return Status::ok;
}

}  // namespace

Status execute(const Request& request, SecureBytes<key_size>& retrieved) noexcept {
  // Legacy login-keychain ACL/unlock UI is not fully controlled by the modern
  // query attribute. This changes only this one-shot library process's flag,
  // never the user's keychain ACL, persistent policy or system security settings.
  const auto interaction = native_error(SecKeychainSetUserInteractionAllowed(false));
  if (interaction != Status::ok) return interaction;
  Owned<CFStringRef> account{CFStringCreateWithCString(kCFAllocatorDefault,
    request.vault_id.data(), kCFStringEncodingASCII)};
  if (account.value == nullptr) return Status::unavailable;
  Owned<CFMutableDictionaryRef> attributes{query(account.value)};
  if (attributes.value == nullptr) return Status::unavailable;
  if (request.operation == Operation::remove) {
    const auto status = native_error(SecItemDelete(attributes.value));
    return status == Status::missing ? Status::ok : status;
  }
  SecureBytes<key_size> existing;
  const auto found = read_key(account.value, existing);
  if (request.operation == Operation::retrieve) {
    if (found == Status::ok)
      std::memcpy(retrieved.bytes.data(), existing.bytes.data(), key_size);
    return found;
  }
  if (found == Status::ok)
    return same_key(existing.bytes.data(), request.key.bytes.data()) ? Status::ok : Status::conflict;
  if (found != Status::missing) return found;
  // The API's atomic add refuses an existing item; never use SecItemUpdate.
  Owned<CFDataRef> key{CFDataCreateWithBytesNoCopy(kCFAllocatorDefault,
    request.key.bytes.data(), key_size, kCFAllocatorNull)};
  if (key.value == nullptr) return Status::unavailable;
  CFDictionarySetValue(attributes.value, kSecValueData, key.value);
  const auto added = native_error(SecItemAdd(attributes.value, nullptr));
  if (added != Status::conflict) return added;
  const auto raced = read_key(account.value, existing);
  if (raced != Status::ok) return raced;
  return same_key(existing.bytes.data(), request.key.bytes.data()) ? Status::ok : Status::conflict;
}

}  // namespace chausar::keychain
