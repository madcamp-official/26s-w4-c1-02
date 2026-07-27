import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadDotenv } from 'dotenv'
import type { NextConfig } from 'next'

// Next 는 **앱 디렉터리 기준**으로만 .env 를 찾는다 (apps/web/.env). 이 모노레포의 .env 는
// 레포 루트에 하나뿐이므로, 아무것도 안 하면 DATABASE_URL 이 undefined 가 되어
// 화면과 공개 API 가 통째로 "불러오지 못했어요" 상태가 된다.
// next.config 는 서버가 뜨기 전에 Node 에서 평가되므로 여기서 채우면 런타임 전체에 전달된다.
// worker/src/config.ts · core/drizzle.config.ts 와 같은 방식.
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../..', '.env'), quiet: true })

const nextConfig: NextConfig = {
  // @endpointer/core 는 빌드 산출물이 없다 (noEmit). .ts 소스가 그대로 들어오므로
  // Next 가 직접 트랜스파일해야 한다. 이 줄이 빠지면 web 이 즉시 깨진다.
  transpilePackages: ['@endpointer/core'],

  // postgres.js 는 서버 전용 드라이버다. 번들에 넣으면 동적 require 가 깨진다.
  serverExternalPackages: ['postgres'],

  images: {
    // 출처 뱃지에 사이트 파비콘을 붙일 수 있게 열어둔다 (G0 화면에서는 아직 안 쓴다).
    // 대상 사이트가 사용자 입력에서 나오므로 호스트를 미리 다 적을 수 없다 —
    // 그래서 임의 호스트를 직접 부르지 않고 파비콘 중계 주소 한 곳만 연다.
    remotePatterns: [
      { protocol: 'https', hostname: 'www.google.com', pathname: '/s2/favicons/**' },
      { protocol: 'https', hostname: 'icons.duckduckgo.com', pathname: '/ip3/**' },
    ],
    // 파비콘은 아주 작다. 쓸데없이 큰 사이즈를 만들지 않는다.
    imageSizes: [16, 24, 32, 48, 64],
  },

  // 화면에서 새는 정보를 줄인다 (보장선 B4 와 같은 방향).
  poweredByHeader: false,
}

export default nextConfig
