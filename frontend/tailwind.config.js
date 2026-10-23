/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,jsx}'],
    theme: {
        extend: {
            colors: {
                base: '#191A19',
                primary: '#1E5128',
                accent: '#4E9F3D',
                light: '#D8E9A8'
            },
            fontFamily: {
                sans: ['Poppins', 'ui-sans-serif', 'system-ui', 'sans-serif']
            }
        }
    },
    plugins: []
};
