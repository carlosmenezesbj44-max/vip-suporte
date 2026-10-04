import './globals.css';

export const metadata = {
  title: 'Canal Direto',
  description: 'Central de atendimento do provedor',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
