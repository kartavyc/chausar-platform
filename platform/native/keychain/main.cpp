#include "protocol.hpp"

#include <cstdio>

#if defined(_WIN32)
#include <fcntl.h>
#include <io.h>
static constexpr unsigned char backend = 1;
#elif defined(__APPLE__)
static constexpr unsigned char backend = 2;
#elif defined(__linux__)
static constexpr unsigned char backend = 3;
#else
#error Unsupported keychain platform; no fallback backend exists.
#endif

int main(int argc, char**) {
  using namespace chausar::keychain;
  // Unbuffered binary pipes prevent newline translation and long-lived stdio
  // copies. No arguments, environment selectors or filesystem input are used.
  std::setvbuf(stdin, nullptr, _IONBF, 0);
  std::setvbuf(stdout, nullptr, _IONBF, 0);
#if defined(_WIN32)
  if (_setmode(_fileno(stdin), _O_BINARY) == -1 ||
      _setmode(_fileno(stdout), _O_BINARY) == -1) return 1;
#endif
  SecureBytes<store_request_size + 1> input;
  SecureBytes<key_size> retrieved;
  SecureBytes<7 + key_size> response;
  Request request;
  Status status = Status::invalid;
  std::size_t size = 0;
  if (argc == 1) {
    // One extra byte detects trailing bytes without an unbounded allocation.
    while (size < input.bytes.size()) {
      const auto count = std::fread(input.bytes.data() + size, 1, 1, stdin);
      if (count == 0) break;
      ++size;
    }
    if (std::feof(stdin) && !std::ferror(stdin) &&
        parse_request(input.bytes.data(), size, request)) {
      secure_clear(input.bytes.data(), input.bytes.size());
      status = execute(request, retrieved);
    }
  }
  std::memcpy(response.bytes.data(), "CKR1", 4);
  response.bytes[4] = static_cast<unsigned char>(status);
  response.bytes[5] = backend;
  const bool emit_key = status == Status::ok && request.operation == Operation::retrieve;
  response.bytes[6] = emit_key ? key_size : 0;
  if (emit_key) std::memcpy(response.bytes.data() + 7, retrieved.bytes.data(), key_size);
  const auto response_size = emit_key ? 7 + key_size : 7;
  const auto written = std::fwrite(response.bytes.data(), 1, response_size, stdout);
  return written == response_size && std::fflush(stdout) == 0 ? 0 : 1;
}
