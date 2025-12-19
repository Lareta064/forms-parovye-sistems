// --- Imports (ESM) ---
import gulp from "gulp";
import * as dartSass from "sass";
import gulpSass from "gulp-sass";
const sass = gulpSass(dartSass);

import pug from "gulp-pug";
import { deleteAsync } from "del";
import browserSyncPkg from "browser-sync";
const browserSync = browserSyncPkg.create();
import webp from "gulp-webp";
import ttf2woff2 from "gulp-ttf2woff2";
import concat from "gulp-concat";
import autoprefixer from "gulp-autoprefixer";
import sourcemaps from "gulp-sourcemaps";
import plumber from "gulp-plumber";
import notify from "gulp-notify";
import gcmq from "gulp-group-css-media-queries";
import formatHtml from "gulp-format-html";
import imagemin from "gulp-imagemin";

// --- Paths ---
export const paths = {
  pugPages: "./src/pug/pages/**/*.pug",
  pugUi: "./src/pug/ui/**/*.pug",
  scssEntry: "./src/scss/main.scss",
  scssAll: "./src/scss/**/*.scss",
  jsAll: "./src/js/**/*.js",
  libsAll: "./src/libs/**/*.*",
  videoAll: "./src/video/**/*.*",

  // IMAGES (без спрайта)
  imgsSvg: "./src/img/**/*.svg",
  imgsJpgPng: "./src/img/**/*.{jpg,jpeg,png}",
  imgsOther: ["./src/img/**/*", "!./src/img/**/*.{jpg,jpeg,png,svg}"],

  // FONTS
  fontsTtf: "./src/fonts/**/*.ttf",
  fontsReady: "./src/fonts/**/*.{woff,woff2}",

  // BUILD
  build: "./build/"
};

// --- Tasks ---
export const clean = () => deleteAsync(paths.build);

// PUG
export function pugPages() {
  return gulp.src(paths.pugPages)
    .pipe(plumber({ errorHandler: notify.onError("PUG error: <%= error.message %>") }))
    .pipe(pug({ pretty: true }))
    .pipe(formatHtml())
    .pipe(gulp.dest(`${paths.build}/`))
    .pipe(browserSync.stream());
}
export function pugUi() {
  return gulp.src(paths.pugUi)
    .pipe(plumber({ errorHandler: notify.onError("PUG UI error: <%= error.message %>") }))
    .pipe(pug({ pretty: true }))
    .pipe(formatHtml())
    .pipe(gulp.dest(`${paths.build}/ui`))
    .pipe(browserSync.stream());
}

// SCSS
export function styles() {
  return gulp.src(paths.scssEntry)
    .pipe(plumber({ errorHandler: notify.onError("SCSS error: <%= error.message %>") }))
    .pipe(sourcemaps.init())
    .pipe(sass({ outputStyle: "expanded" }))
    .pipe(autoprefixer({ cascade: false }))
    .pipe(gcmq())
    .pipe(sourcemaps.write("."))
    .pipe(gulp.dest(`${paths.build}/css`))
    .pipe(browserSync.stream());
}

// Images
export function imgWebp() {
  return gulp.src(paths.imgsJpgPng)
    .pipe(imagemin({ verbose: true }))
    .pipe(webp())
    .pipe(gulp.dest(`${paths.build}/img`));
}
export function imgCopySvg() {
  return gulp.src(paths.imgsSvg)     // SVG копируем как есть
    .pipe(gulp.dest(`${paths.build}/img`));
}
export function imgCopyOther() {
  return gulp.src(paths.imgsOther)
    .pipe(imagemin({ verbose: true }))
    .pipe(gulp.dest(`${paths.build}/img`));
}
export const images = gulp.parallel(imgWebp, imgCopySvg, imgCopyOther);

// Fonts
export function fontsTtf2woff2() {
  return gulp.src(paths.fontsTtf)
    .pipe(ttf2woff2())
    .pipe(gulp.dest(`${paths.build}/fonts`));
}
export function fontsCopy() {
  return gulp.src(paths.fontsReady)
    .pipe(gulp.dest(`${paths.build}/fonts`));
}
export const fonts = gulp.parallel(fontsTtf2woff2, fontsCopy);

// JS
export function scripts() {
  return gulp.src(paths.jsAll)
    .pipe(concat("main.js"))
    .pipe(gulp.dest(`${paths.build}/js`));
}

// Libs / Video
export function copyLibs() {
  return gulp.src(paths.libsAll).pipe(gulp.dest(`${paths.build}/libs`));
}
export function copyVideo() {
  return gulp.src(paths.videoAll).pipe(gulp.dest(`${paths.build}/video`));
}

// Server
export function server() {
  browserSync.init({
    server: { baseDir: paths.build },
    notify: false,
    open: true
  });
}

// Watchers
export function watch() {
  gulp.watch("./src/pug/**/*.pug", pugPages);
  gulp.watch(paths.pugUi, pugUi);
  gulp.watch(paths.scssAll, styles);

  gulp.watch(paths.jsAll, gulp.series(scripts, (done) => { browserSync.reload(); done(); }));
  gulp.watch(paths.libsAll, gulp.series(copyLibs, (done) => { browserSync.reload(); done(); }));

  // IMAGES (без спрайта)
  gulp.watch(paths.imgsSvg, gulp.series(imgCopySvg, (done)=>{ console.log("🖼 SVG скопированы"); browserSync.reload(); done(); }));
  gulp.watch(paths.imgsOther, gulp.series(imgCopyOther, (done)=>{ browserSync.reload(); done(); }));
  gulp.watch(paths.imgsJpgPng, gulp.series(imgWebp, (done)=>{ browserSync.reload(); done(); }));

  gulp.watch(paths.fontsTtf, gulp.series(fontsTtf2woff2, (done)=>{ browserSync.reload(); done(); }));
  gulp.watch(paths.fontsReady, gulp.series(fontsCopy, (done)=>{ browserSync.reload(); done(); }));
}

// Сборки
export const build = gulp.series(
  clean,
  gulp.parallel(pugPages, pugUi, styles, scripts, copyLibs, images, fonts, copyVideo)
);
export default gulp.series(
  clean,
  gulp.parallel(pugPages, pugUi, styles, scripts, copyLibs, images, fonts, copyVideo),
  gulp.parallel(server, watch)
);
