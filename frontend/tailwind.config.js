/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        crochet: {
          primary: '#E50914',    // Rojo Netflix
          dark: '#141414',       // Negro Netflix
          gray: '#808080',
          light: '#E5E5E5',
          purple: '#7B2D8E',     // Opcional alternativo
        }
      }
    },
  },
  plugins: [],
}