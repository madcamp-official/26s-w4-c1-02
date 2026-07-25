/**
 * Tailwind v4 는 CSS-first 다. `tailwind.config.js` 를 만들지 않는다 —
 * 색·폰트 토큰은 app/globals.css 의 `@theme` 블록에 있다.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
