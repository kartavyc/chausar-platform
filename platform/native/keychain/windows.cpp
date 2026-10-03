#include "protocol.hpp"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wincred.h>
#include <sddl.h>

#include <string>
#include <vector>

namespace chausar::keychain {
namespace {

Status native_error(DWORD error) noexcept {
  if (error == ERROR_NOT_FOUND) return Status::missing;
  if (error == ERROR_ACCESS_DENIED || error == ERROR_PRIVILEGE_NOT_HELD)
    return Status::denied;
  return Status::unavailable;
}

struct Credential {
  PCREDENTIALW value = nullptr;
  ~Credential() {
    if (value != nullptr) {
      if (value->CredentialBlob != nullptr)
        SecureZeroMemory(value->CredentialBlob, value->CredentialBlobSize);
      CredFree(value);
    }
  }
};

// CredWrite can replace an entry. All helpers for this user and vault acquire
// this ephemeral mutex before read/compare/write; no ACL or privilege is added.
struct VaultMutex {
  HANDLE handle = nullptr;
  bool acquired = false;
  ~VaultMutex() {
    if (acquired) ReleaseMutex(handle);
    if (handle != nullptr) CloseHandle(handle);
  }
  Status acquire(const std::wstring& vault_id) {
    HANDLE token = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token))
      return native_error(GetLastError());
    DWORD length = 0;
    GetTokenInformation(token, TokenUser, nullptr, 0, &length);
    if (length == 0) { CloseHandle(token); return Status::unavailable; }
    std::vector<unsigned char> data(length);
    const BOOL obtained = GetTokenInformation(token, TokenUser, data.data(), length, &length);
    const DWORD token_error = obtained ? ERROR_SUCCESS : GetLastError();
    CloseHandle(token);
    if (!obtained) return native_error(token_error);
    LPWSTR sid = nullptr;
    if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(data.data())->User.Sid, &sid))
      return native_error(GetLastError());
    const std::wstring name = std::wstring(L"Global\\in.chausar.vault.v1.") + sid + L"." + vault_id;
    LocalFree(sid);
    handle = CreateMutexW(nullptr, FALSE, name.c_str());
    if (handle == nullptr) return native_error(GetLastError());
    const DWORD wait = WaitForSingleObject(handle, 0);
    acquired = wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED;
    return acquired ? Status::ok : Status::unavailable;
  }
};

Status read_key(const std::wstring& target, const std::wstring& vault_id,
                SecureBytes<key_size>& key) noexcept {
  Credential credential;
  if (!CredReadW(target.c_str(), CRED_TYPE_GENERIC, 0, &credential.value))
    return native_error(GetLastError());
  if (credential.value->Type != CRED_TYPE_GENERIC ||
      credential.value->CredentialBlobSize != key_size ||
      credential.value->CredentialBlob == nullptr ||
      credential.value->UserName == nullptr || vault_id != credential.value->UserName ||
      credential.value->Persist != CRED_PERSIST_LOCAL_MACHINE)
    return Status::conflict;
  std::memcpy(key.bytes.data(), credential.value->CredentialBlob, key_size);
  return Status::ok;
}

}  // namespace

Status execute(const Request& request, SecureBytes<key_size>& retrieved) noexcept {
  try {
    const std::wstring vault_id(request.vault_id.begin(), request.vault_id.begin() + 36);
    const std::wstring target = std::wstring(L"in.chausar.vault.v1/") + vault_id;
    VaultMutex mutex;
    const auto lock = mutex.acquire(vault_id);
    if (lock != Status::ok) return lock;
    if (request.operation == Operation::remove) {
      if (CredDeleteW(target.c_str(), CRED_TYPE_GENERIC, 0)) return Status::ok;
      const auto status = native_error(GetLastError());
      return status == Status::missing ? Status::ok : status;
    }
    SecureBytes<key_size> existing;
    const auto found = read_key(target, vault_id, existing);
    if (request.operation == Operation::retrieve) {
      if (found == Status::ok)
        std::memcpy(retrieved.bytes.data(), existing.bytes.data(), key_size);
      return found;
    }
    if (found == Status::ok)
      return same_key(existing.bytes.data(), request.key.bytes.data()) ? Status::ok : Status::conflict;
    if (found != Status::missing) return found;
    DWORD persistence[CRED_TYPE_MAXIMUM]{};
    if (!CredGetSessionTypes(CRED_TYPE_MAXIMUM, persistence)) return native_error(GetLastError());
    if (persistence[CRED_TYPE_GENERIC] < CRED_PERSIST_LOCAL_MACHINE) return Status::unavailable;
    CREDENTIALW credential{};
    credential.Type = CRED_TYPE_GENERIC;
    credential.TargetName = const_cast<wchar_t*>(target.c_str());
    credential.UserName = const_cast<wchar_t*>(vault_id.c_str());
    credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
    credential.CredentialBlobSize = key_size;
    credential.CredentialBlob = const_cast<BYTE*>(request.key.bytes.data());
    const BOOL stored = CredWriteW(&credential, 0);
    const DWORD error = stored ? ERROR_SUCCESS : GetLastError();
    SecureZeroMemory(&credential, sizeof(credential));
    return stored ? Status::ok : native_error(error);
  } catch (...) {
    return Status::unavailable;
  }
}

}  // namespace chausar::keychain
