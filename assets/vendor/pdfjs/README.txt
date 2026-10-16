pdf.js (pdfjs-dist) 3.11.174 - 클래식(UMD) 빌드
=================================================
버전: 3.11.174 (3.x 마지막 클래식 빌드. <script> 로 불러오며 file:// 에서도 동작한다)
받은 곳: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-3.11.174.tgz  (2026-10-16 받음)
  tarball 무결성: npm 이 게시한 sha1 5ff47b80f2d58c8dd0d74f615e7c6a7e7e704c4b,
  sha512 TdTZPf1trZ8/UFu5Cx/GXB7GZM30LT+wWUNfsi6Bq8ePLnb+woNKtDymI2mxZYBpMbonNFqKmiz684DIfnd8dA== 와 일치 확인.
  (jsdelivr 는 이 환경에서 정책상 차단되어 교차 확인하지 못했다.)
포함 파일(tarball 의 build/ 와 LICENSE 를 그대로 복사, 수정 없음):
  pdf.min.js         SHA-256 5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946
  pdf.worker.min.js  SHA-256 feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b
  LICENSE.txt        SHA-256 0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594
라이선스: Apache License 2.0 (Copyright Mozilla Foundation). 전문은 LICENSE.txt.
사용: <script src="assets/vendor/pdfjs/pdf.min.js"></script> 다음에 src/pdf.js. 워커 주소는 Pdf.configure({ workerSrc }) 로 지정한다.
알려진 한계: 미리 정해진 CMap(cmaps/)과 표준 글꼴은 포함하지 않았다. 글꼴을 PDF에 넣지 않은 옛 한중일 PDF는 글자가 빠질 수 있다.
