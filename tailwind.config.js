/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#E6F1FB', 100: '#B5D4F4', 500: '#185FA5', 700: '#0C447C', 900: '#042C53' },
        surface: { DEFAULT: '#ffffff', 2: '#f1efe8', 3: '#f5f4f0' },
        border: { light: 'rgba(0,0,0,0.10)', strong: 'rgba(0,0,0,0.18)' },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
