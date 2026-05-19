import type { JSX } from "react";

interface WordmarkProps {
  /** Size: lg = 48px (welcome), md = 22px, sm = 18px */
  size?: "lg" | "md" | "sm";
  className?: string;
}

const WHITE_LETTERS =
  "M 662 283 L 659 286 L 659 431 L 662 434 L 695 434 L 697 432 L 697 285 L 695 283 Z M 978 271 L 957 280 L 947 287 L 933 301 L 925 313 L 917 333 L 915 344 L 915 366 L 917 376 L 921 387 L 932 406 L 945 419 L 959 428 L 973 434 L 994 438 L 1007 438 L 1026 435 L 1039 430 L 1053 422 L 1069 406 L 1070 402 L 1045 386 L 1042 386 L 1029 398 L 1017 403 L 987 403 L 974 397 L 959 382 L 954 369 L 1075 368 L 1078 367 L 1080 364 L 1080 346 L 1077 330 L 1072 316 L 1061 298 L 1050 287 L 1037 278 L 1022 272 L 1008 269 L 989 269 Z M 954 336 L 963 320 L 975 310 L 991 304 L 1005 304 L 1017 307 L 1028 314 L 1038 326 L 1042 335 L 1042 339 L 955 340 Z M 890 218 L 861 217 L 856 221 L 855 294 L 841 281 L 826 273 L 811 269 L 791 269 L 775 273 L 756 283 L 739 299 L 732 309 L 726 321 L 721 336 L 721 372 L 725 386 L 733 402 L 740 411 L 755 424 L 767 431 L 778 435 L 793 438 L 808 438 L 829 433 L 835 430 L 855 414 L 856 432 L 858 434 L 892 433 L 893 221 Z M 796 307 L 813 306 L 829 311 L 847 327 L 853 339 L 856 352 L 856 359 L 851 377 L 839 392 L 824 401 L 816 403 L 800 403 L 785 398 L 768 383 L 760 366 L 759 347 L 766 329 L 782 313 Z";

const CYAN_NUMBERS =
  "M 1372 255 L 1352 250 L 1335 250 L 1309 258 L 1296 266 L 1284 278 L 1273 298 L 1271 307 L 1272 333 L 1277 346 L 1285 358 L 1297 369 L 1310 376 L 1324 380 L 1342 381 L 1307 429 L 1307 434 L 1349 433 L 1392 373 L 1406 351 L 1410 342 L 1415 320 L 1414 304 L 1410 290 L 1404 279 L 1398 272 L 1386 262 Z M 1330 286 L 1338 284 L 1350 284 L 1357 286 L 1364 290 L 1374 301 L 1378 313 L 1377 324 L 1370 336 L 1362 343 L 1356 346 L 1348 348 L 1330 346 L 1320 340 L 1315 335 L 1310 326 L 1309 311 L 1313 300 L 1318 294 Z M 1199 252 L 1189 250 L 1169 250 L 1142 259 L 1127 270 L 1119 279 L 1112 291 L 1108 302 L 1107 330 L 1111 342 L 1119 356 L 1130 367 L 1149 377 L 1163 380 L 1179 380 L 1143 430 L 1143 434 L 1184 434 L 1191 426 L 1232 367 L 1243 349 L 1249 334 L 1251 324 L 1251 311 L 1249 298 L 1243 284 L 1238 277 L 1222 262 Z M 1166 286 L 1173 284 L 1190 285 L 1200 290 L 1210 301 L 1214 313 L 1213 323 L 1211 329 L 1205 337 L 1196 344 L 1184 348 L 1169 347 L 1157 341 L 1148 331 L 1144 319 L 1146 306 L 1151 297 L 1157 291 Z";

/**
 * Bracket variant of the wordmark: `[ide99]` — white letters
 * (currentColor) plus brackets/digits in `--brand-q`. The dot above "i"
 * blinks irregularly (calm 5–9 s cycle). This is the default lockup.
 */
export function Wordmark({ size = "lg", className = "" }: WordmarkProps): JSX.Element {
  const sizeClass = size === "lg" ? "" : size === "md" ? "md" : "sm";
  return (
    <svg
      className={`q-wordmark ${sizeClass} ${className}`.trim()}
      viewBox="528 192 1000 290"
      role="img"
      aria-label="ide99"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={WHITE_LETTERS} fill="currentColor" fillRule="evenodd" />
      <path d={CYAN_NUMBERS} fill="var(--brand-q)" fillRule="evenodd" />
      <path
        d="M 590 206 H 542 V 468 H 590"
        fill="none"
        stroke="var(--brand-q)"
        strokeWidth="18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 1464 206 H 1514 V 468 H 1464"
        fill="none"
        stroke="var(--brand-q)"
        strokeWidth="18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle className="q-wordmark-dot" cx="679" cy="239.5" r="22.8" fill="currentColor" />
    </svg>
  );
}
