cmake_minimum_required(VERSION 3.20)
project(chausar_keychain LANGUAGES CXX)

option(CHAUSAR_KEYCHAIN_PROTOCOL_ONLY "Build only the synthetic parser test without native backends" OFF)
add_executable(chausar-keychain-protocol-selftest EXCLUDE_FROM_ALL protocol-selftest.cpp)
target_compile_features(chausar-keychain-protocol-selftest PRIVATE cxx_std_17)
enable_testing()
add_test(NAME chausar-keychain-protocol COMMAND chausar-keychain-protocol-selftest)

# The parser test contains no call to execute(), provider translation unit or
# native library. Return before resolving any OS dependency in this mode.
if(CHAUSAR_KEYCHAIN_PROTOCOL_ONLY)
  return()
endif()

add_executable(chausar-keychain main.cpp)
target_compile_features(chausar-keychain PRIVATE cxx_std_17)

if(WIN32)
  target_sources(chausar-keychain PRIVATE windows.cpp)
  target_link_libraries(chausar-keychain PRIVATE advapi32)
elseif(APPLE)
  target_sources(chausar-keychain PRIVATE macos.cpp)
  find_library(SECURITY_FRAMEWORK Security REQUIRED)
  find_library(COREFOUNDATION_FRAMEWORK CoreFoundation REQUIRED)
  target_link_libraries(chausar-keychain PRIVATE ${SECURITY_FRAMEWORK} ${COREFOUNDATION_FRAMEWORK})
elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  target_sources(chausar-keychain PRIVATE linux.cpp)
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(LIBSECRET REQUIRED IMPORTED_TARGET libsecret-1)
  pkg_check_modules(GLIB REQUIRED IMPORTED_TARGET glib-2.0>=2.50)
  target_link_libraries(chausar-keychain PRIVATE PkgConfig::LIBSECRET PkgConfig::GLIB)
else()
  message(FATAL_ERROR "Unsupported keychain platform; no fallback backend exists")
endif()

if(MSVC)
  target_compile_options(chausar-keychain PRIVATE /W4)
else()
  target_compile_options(chausar-keychain PRIVATE -Wall -Wextra -Wpedantic)
endif()

# This target supplies source only. Parent release work must compile, qualify,
# sign and inventory the resulting helper and all distributed native libraries.
