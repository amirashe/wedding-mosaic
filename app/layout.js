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
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Cormorant+Garamond:ital,wght@1,300;1,400&family=Rubik:wght@300;400;500;600;700;900&display=swap"
          rel="stylesheet"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
        <meta name="theme-color" content="#c9a84c" />
      </head>
      <body>{children}</body>
    </html>
  )
}
