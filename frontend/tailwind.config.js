/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        erpBg: '#f3f4f6',
        erpPanel: '#ffffff',
        erpSidebar: '#1e293b',
        erpPrimary: '#2563eb'
      }
    },
  },
  plugins: [],
}