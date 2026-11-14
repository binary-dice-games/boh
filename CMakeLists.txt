# https://cliutils.gitlab.io/modern-cmake/
# CMake is the entry point; the code is TypeScript/JavaScript built with npm.

cmake_minimum_required(VERSION 3.14...3.28)

project(
  Boh
  VERSION 0.1.0
  LANGUAGES NONE)

option(BOH_BUILD_TESTS "Register the boh tests with ctest" ${PROJECT_IS_TOP_LEVEL})

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(BohNode)
include(BohTests)

# Lint, typecheck and format check.
add_custom_target(
  check
  COMMAND "${BOH_NPM}" run check
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  COMMENT "boh: lint, typecheck, format check"
  VERBATIM)

# The page bundle in web/dist.
add_custom_target(
  web
  COMMAND "${BOH_NPM}" run build:web
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  COMMENT "boh: build the web page"
  VERBATIM)

# The GitHub Pages site (the page, 404) in site/.
add_custom_target(
  site
  COMMAND "${BOH_NPM}" run build:site
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  COMMENT "boh: assemble the GitHub Pages site"
  VERBATIM)

if(BOH_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()
