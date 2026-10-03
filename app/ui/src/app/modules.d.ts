/* CSS Modules: a class map per stylesheet. This is the standard shim for a bundler that
   understands *.module.css; it declares no React or library type. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
