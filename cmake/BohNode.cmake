# Finds Node.js and npm and installs the npm dependencies on first configure, and again when
# package-lock.json is newer than what was installed (a pull or a branch switch that changed the
# dependencies), like updating submodules.
#
# Sets BOH_NODE and BOH_NPM.

find_program(BOH_NODE node)
# On Windows npm is a .cmd file; the extensionless `npm` next to it is a shell script that
# CreateProcess cannot run, so ask for npm.cmd first.
find_program(BOH_NPM NAMES npm.cmd npm)
if(NOT BOH_NODE OR NOT BOH_NPM)
  message(FATAL_ERROR "boh needs Node.js 20+ and npm on PATH (see docs/building.md)")
endif()

set(_boh_installed "${CMAKE_CURRENT_SOURCE_DIR}/node_modules/.package-lock.json")
set(_boh_lock "${CMAKE_CURRENT_SOURCE_DIR}/package-lock.json")
# Configure again when the lock file changes, so a build after a pull installs what it needs.
if(EXISTS "${_boh_lock}")
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${_boh_lock}")
endif()
if(NOT EXISTS "${_boh_installed}"
   OR (EXISTS "${_boh_lock}" AND "${_boh_lock}" IS_NEWER_THAN "${_boh_installed}"))
  if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/package-lock.json")
    set(_boh_npm_install ci)
  else()
    set(_boh_npm_install install)
  endif()
  message(STATUS "boh: npm ${_boh_npm_install}")
  execute_process(
    COMMAND "${BOH_NPM}" ${_boh_npm_install} --no-audit --no-fund
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    RESULT_VARIABLE _boh_npm_result
    OUTPUT_VARIABLE _boh_npm_output
    ERROR_VARIABLE _boh_npm_output)
  if(NOT _boh_npm_result EQUAL 0)
    message(FATAL_ERROR "boh: npm ${_boh_npm_install} failed (${_boh_npm_result}):\n${_boh_npm_output}")
  endif()
endif()
