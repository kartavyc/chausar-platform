#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace chausar::keychain {

inline constexpr char service[] = "in.chausar.vault.v1";
inline constexpr std::size_t key_size = 32;
inline constexpr std::size_t request_prefix_size = 41;
inline constexpr std::size_t store_request_size = 73;

enum class Operation : std::uint8_t { store = 1, retrieve = 2, remove = 3 };
enum class Status : std::uint8_t {
  ok = 0, missing = 1, unavailable = 2, denied = 3, conflict = 4, invalid = 5
};

// Volatile byte writes keep this portable buffer clearing observable. Platform
// APIs and libsecret retain their own copies; this does not claim to wipe those.
inline void secure_clear(void* memory, std::size_t size) noexcept {
  auto* bytes = static_cast<volatile unsigned char*>(memory);
  while (size-- != 0) *bytes++ = 0;
}

template <std::size_t Size> struct SecureBytes {
  std::array<unsigned char, Size> bytes{};
  SecureBytes() = default;
  SecureBytes(const SecureBytes&) = delete;
  SecureBytes& operator=(const SecureBytes&) = delete;
  ~SecureBytes() { secure_clear(bytes.data(), bytes.size()); }
};

struct Request {
  Operation operation = Operation::retrieve;
  std::array<char, 37> vault_id{};
  SecureBytes<key_size> key;
};

inline bool valid_vault_id(const unsigned char* id) noexcept {
  for (std::size_t i = 0; i < 36; ++i) {
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (id[i] != '-') return false;
    } else if (!((id[i] >= '0' && id[i] <= '9') ||
                 (id[i] >= 'a' && id[i] <= 'f'))) {
      return false;
    }
  }
  return true;
}

// The caller must have observed EOF, rather than treating a valid prefix as a
// complete request. No native operation occurs until this succeeds.
inline bool parse_request(const unsigned char* bytes, std::size_t size,
                          Request& request) noexcept {
  if (size != request_prefix_size && size != store_request_size) return false;
  if (std::memcmp(bytes, "CKP1", 4) != 0 || !valid_vault_id(bytes + 5)) return false;
  const auto operation = static_cast<Operation>(bytes[4]);
  if (operation != Operation::store && operation != Operation::retrieve &&
      operation != Operation::remove) return false;
  if (size != (operation == Operation::store ? store_request_size : request_prefix_size))
    return false;
  request.operation = operation;
  std::memcpy(request.vault_id.data(), bytes + 5, 36);
  request.vault_id[36] = '\0';
  if (operation == Operation::store)
    std::memcpy(request.key.bytes.data(), bytes + request_prefix_size, key_size);
  return true;
}

inline bool same_key(const unsigned char* left, const unsigned char* right) noexcept {
  unsigned char difference = 0;
  for (std::size_t i = 0; i < key_size; ++i) difference |= left[i] ^ right[i];
  return difference == 0;
}

// Exactly one of the platform translation units supplies this function.
Status execute(const Request& request, SecureBytes<key_size>& retrieved) noexcept;

}  // namespace chausar::keychain
