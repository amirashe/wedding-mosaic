import './globals.css'

export const metadata = {
  title: 'מוזאיקת החתונה של מעיין ואמיר 💑',
  description: 'העלו תמונה למוזאיקה שלנו',
}

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700;900&display=swap"
          rel="stylesheet"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
        <meta name="theme-color" content="#16a34a" />
      </head>
      <body>{children}</body>
    </html>
  )
}
