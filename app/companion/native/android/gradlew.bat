@echo off
setlocal
set "WRAPPER_JAR=%~dp0gradle\wrapper\gradle-wrapper.jar"
if not exist "%WRAPPER_JAR%" (
  echo Gradle wrapper JAR is absent. Follow native/README.md toolchain prerequisites. 1>&2
  exit /b 1
)
if defined JAVA_HOME (
  set "JAVA_COMMAND=%JAVA_HOME%\bin\java.exe"
) else (
  set "JAVA_COMMAND=java.exe"
)
"%JAVA_COMMAND%" -classpath "%WRAPPER_JAR%" org.gradle.wrapper.GradleWrapperMain %*
exit /b %ERRORLEVEL%
