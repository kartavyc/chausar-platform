// Portable synthetic parser test only. This target does not link main.cpp or
// any platform backend, import native credential APIs, or exercise native stores.
#include "protocol.hpp"

#include <cstdio>
#include <cstdlib>

namespace {
unsigned int checks = 0;
void require(bool value) {
  ++checks;
  if (!value) { std::fputs("protocol self-test failed\n", stderr); std::abort(); }
}
}

int main() {
  using namespace chausar::keychain;
  constexpr char id[] = "01234567-89ab-cdef-0123-456789abcdef";
  SecureBytes<store_request_size + 1> fixture;
  std::memcpy(fixture.bytes.data(), "CKP1", 4);
  std::memcpy(fixture.bytes.data() + 5, id, 36);
  for (std::size_t i = request_prefix_size; i < store_request_size; ++i)
    fixture.bytes[i] = static_cast<unsigned char>(i);  // Synthetic bytes only.

  for (const auto operation : {Operation::store, Operation::retrieve, Operation::remove}) {
    fixture.bytes[4] = static_cast<unsigned char>(operation);
    const auto expected = operation == Operation::store ? store_request_size : request_prefix_size;
    for (std::size_t size = 0; size <= fixture.bytes.size(); ++size) {
      Request request;
      const auto accepted = parse_request(fixture.bytes.data(), size, request);
      require(accepted == (size == expected));
      if (accepted) {
        require(request.operation == operation);
        require(std::strcmp(request.vault_id.data(), id) == 0);
        require(request.vault_id[36] == '\0');
        if (operation == Operation::store)
          require(std::memcmp(request.key.bytes.data(), fixture.bytes.data() + request_prefix_size, key_size) == 0);
        else
          for (const auto byte : request.key.bytes) require(byte == 0);
      }
    }
  }
  fixture.bytes[4] = static_cast<unsigned char>(Operation::store);
  for (std::size_t i = 0; i < 4; ++i) {
    const auto original = fixture.bytes[i];
    fixture.bytes[i] = 0;
    Request request;
    require(!parse_request(fixture.bytes.data(), store_request_size, request));
    fixture.bytes[i] = original;
  }
  for (const auto operation : {0u, 4u, 255u}) {
    fixture.bytes[4] = static_cast<unsigned char>(operation);
    Request request;
    require(!parse_request(fixture.bytes.data(), store_request_size, request));
  }
  fixture.bytes[4] = static_cast<unsigned char>(Operation::store);
  for (std::size_t i = 0; i < 36; ++i) {
    const auto original = fixture.bytes[5 + i];
    for (const auto replacement : {static_cast<unsigned char>(0), static_cast<unsigned char>('A'),
                                   static_cast<unsigned char>('/'), static_cast<unsigned char>('g')}) {
      fixture.bytes[5 + i] = replacement;
      Request request;
      require(!parse_request(fixture.bytes.data(), store_request_size, request));
    }
    fixture.bytes[5 + i] = original;
  }
  SecureBytes<key_size> left, right;
  left.bytes.fill(0x55);
  right.bytes.fill(0x55);
  require(same_key(left.bytes.data(), right.bytes.data()));
  for (std::size_t i = 0; i < key_size; ++i) {
    right.bytes[i] ^= 1;
    require(!same_key(left.bytes.data(), right.bytes.data()));
    right.bytes[i] ^= 1;
  }
  secure_clear(left.bytes.data(), left.bytes.size());
  for (const auto byte : left.bytes) require(byte == 0);
  std::printf("protocol self-test passed: %u checks\n", checks);
  return 0;
}
