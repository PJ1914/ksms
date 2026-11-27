// Web only: Inter everywhere except the icon font. No user data is sent; it is a public stylesheet.
if (typeof document !== 'undefined' && !document.getElementById('ksms-font')) {
  const link = document.createElement('link');
  link.id = 'ksms-font';
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
  document.head.appendChild(link);
  const style = document.createElement('style');
  style.textContent =
    '*:not([style*="onicons"]){font-family:"Inter",system-ui,-apple-system,"Segoe UI",sans-serif !important;letter-spacing:-0.005em}' +
    'body{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}';
  document.head.appendChild(style);
}
export {};
