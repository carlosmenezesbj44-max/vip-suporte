const value = process.env.NEXT_PUBLIC_API_URL?.trim();

if (!value) {
  console.error('Defina NEXT_PUBLIC_API_URL nas variáveis de build do Cloudflare.');
  process.exit(1);
}

let apiUrl;
try {
  apiUrl = new URL(value);
} catch {
  console.error('NEXT_PUBLIC_API_URL precisa ser uma URL HTTPS pública terminada em /api.');
  process.exit(1);
}

if (
  apiUrl.protocol !== 'https:' ||
  ['localhost', '127.0.0.1', '0.0.0.0'].includes(apiUrl.hostname) ||
  !apiUrl.pathname.replace(/\/$/, '').endsWith('/api')
) {
  console.error('NEXT_PUBLIC_API_URL precisa ser uma URL HTTPS pública terminada em /api.');
  process.exit(1);
}
