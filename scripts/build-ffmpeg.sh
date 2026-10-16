#!/usr/bin/env bash
# scripts/build-ffmpeg.sh
#
# Purpose: build a static, RIST-capable ffmpeg/ffprobe for the platforms scripts/fetch-ffmpeg.js serves
#          (darwin/arm64, darwin/x64, win32/x64) from the latest ffmpeg.org release tarball.
# Why:     the prebuilt macOS (martin-riedl.de) and Windows (gyan.dev "essentials") builds lack librist,
#          which the screenstream plugin needs ("This ffmpeg build has no RIST support").
# Output:  <OUT>/<platform>/<arch>/{ffmpeg[.exe],ffprobe[.exe],versions.txt}, the layout fetch-ffmpeg.js
#          downloads from BASE (https://www.pastordaniel.net/bigmedia/ffmpeg). Upload that tree.
#
# Usage:   scripts/build-ffmpeg.sh <darwin-arm64 | darwin-x64 | win32-x64>
#            darwin-*  run on a Mac (x64 can be cross-built on Apple Silicon; needs no Rosetta).
#            win32-x64 run on Linux or WSL with mingw-w64 (cross-compile; far simpler than MSYS2).
# Env:     FFMPEG_VERSION  override the version (default: newest on ffmpeg.org/releases)
#          WORK            scratch dir (default ./ffmpeg-build-work)   OUT   output dir (default ./ffmpeg-out)
#          JOBS            parallel jobs
# Tools:   macOS:  brew install nasm cmake meson ninja pkg-config
#          Debian: apt install build-essential nasm cmake meson ninja-build pkg-config git curl xz-utils mingw-w64
# HW enc:  win32 also gets h264_nvenc/hevc_nvenc (nv-codec-headers) and h264_amf/hevc_amf (AMF headers); darwin gets
#          videotoolbox. QSV is left out (needs libvpl). screenstream lets users pick these via its videoEncoder setting.
# Codecs:  exactly what the plugins call (plugins/screenstream, mediafx, compactor, revelation/server/thumbnails.js):
#          libx264, libvpx(vp9), libaom(av1), libsvtav1, libopus, librist (+mbedtls for AES), libmp3lame and libvorbis
#          (mediafx passes the UI's audio choice straight to -c:a: mp3 needs lame, vorbis needs libvorbis because the
#          native vorbis encoder is experimental). libaom also provides software AV1 *decoding* for mediafx inputs. aac, prores_ks and the
#          capture devices (avfoundation, gdigrab, dshow) are native to ffmpeg. GPL (x264), as the current builds are.
# Gotchas: untested cross combinations fail loudly at the final RIST check. Dependency versions are pinned below;
#          bump them deliberately. Nothing here runs on the app's machines, only on the build host.
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  darwin-arm64) PLATFORM=darwin; ARCH=arm64;  FF_ARCH=arm64;  TRIPLET=aarch64-apple-darwin; MINVER=11.0 ;;
  darwin-x64)   PLATFORM=darwin; ARCH=x64;    FF_ARCH=x86_64; TRIPLET=x86_64-apple-darwin;  MINVER=10.15 ;;
  win32-x64)    PLATFORM=win32;  ARCH=x64;    FF_ARCH=x86_64; TRIPLET=x86_64-w64-mingw32;   MINVER= ;;
  *) echo "Usage: $0 <darwin-arm64|darwin-x64|win32-x64>" >&2; exit 1 ;;
esac

# Pinned dependency versions.
OPUS_VER=1.5.2
LIBVPX_TAG=v1.15.0
AOM_TAG=v3.15.2   # >= 3.13: older libaom rejects NASM 3.x (its -Ox help-text check), which Homebrew and current distros ship
SVTAV1_TAG=v3.0.0
LIBRIST_TAG=v0.2.10
MBEDTLS_VER=3.6.2
LAME_VER=3.100
OGG_VER=1.3.5
VORBIS_VER=1.3.7
NVCODEC_TAG=n12.2.72.0   # headers only; ffmpeg loads the NVIDIA driver's own library at runtime. Older tag = older drivers still work.
AMF_TAG=v1.5.3          # headers only; AMD's driver provides the runtime. ffmpeg 9 needs >= 1.5.2

WORK="$(mkdir -p "${WORK:-./ffmpeg-build-work}" && cd "${WORK:-./ffmpeg-build-work}" && pwd)/$TARGET"
OUT="$(mkdir -p "${OUT:-./ffmpeg-out}" && cd "${OUT:-./ffmpeg-out}" && pwd)"
PREFIX="$WORK/prefix"
SRC="$WORK/src"
JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"
mkdir -p "$PREFIX" "$SRC"

# Provenance stamp, appended to ffmpeg's version string (`ffmpeg -version`, which adds the "-"): revelation+<app version>+<commit>+<date>.
# "-dirty" is added to the commit when the working tree has uncommitted changes.
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$REPO_DIR/package.json" | head -1)"
GIT_COMMIT="$(git -C "$REPO_DIR" rev-parse --short=7 HEAD 2>/dev/null || echo nogit)"
[ -z "$(git -C "$REPO_DIR" status --porcelain 2>/dev/null)" ] || GIT_COMMIT="$GIT_COMMIT-dirty"
BUILD_DATE="$(date -u +%Y%m%d)"
STAMP="revelation+${APP_VERSION:-unknown}+$GIT_COMMIT+$BUILD_DATE"

HOST_OS="$(uname -s)"
HOST_ARCH="$(uname -m)"

# --- Preflight ---
need() { command -v "$1" &>/dev/null || { echo "ERROR: '$1' not found in PATH." >&2; MISSING=1; }; }
MISSING=0
for c in curl git make cmake meson ninja pkg-config nasm tar xz; do need "$c"; done
if [ "$PLATFORM" = darwin ]; then
  [ "$HOST_OS" = Darwin ] || { echo "ERROR: $TARGET must be built on macOS." >&2; exit 1; }
  need clang
else
  [ "$HOST_OS" = Linux ] || { echo "ERROR: win32-x64 is cross-built from Linux or WSL." >&2; exit 1; }
  MINGW_CC="$(command -v x86_64-w64-mingw32-gcc-posix || command -v x86_64-w64-mingw32-gcc || true)"
  MINGW_CXX="$(command -v x86_64-w64-mingw32-g++-posix || command -v x86_64-w64-mingw32-g++ || true)"
  [ -n "$MINGW_CC" ] && [ -n "$MINGW_CXX" ] || { echo "ERROR: mingw-w64 (x86_64-w64-mingw32-gcc) not found." >&2; MISSING=1; }
fi
[ "$MISSING" = 0 ] || exit 1

# --- Toolchain per target ---
# Only our prefix is searched for libraries, so Homebrew/system copies are never linked in by accident.
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
export PKG_CONFIG_PATH=
CROSS=0
CMAKE_ARGS=(-G Ninja -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_BUILD_TYPE=Release
            -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DBUILD_SHARED_LIBS=OFF)
FF_CROSS_ARGS=()

if [ "$PLATFORM" = darwin ]; then
  export CC="clang -arch $FF_ARCH -mmacosx-version-min=$MINVER"
  export CXX="clang++ -arch $FF_ARCH -mmacosx-version-min=$MINVER"
  export LDFLAGS="-arch $FF_ARCH -mmacosx-version-min=$MINVER"
  CMAKE_ARGS+=(-DCMAKE_OSX_ARCHITECTURES="$FF_ARCH" -DCMAKE_OSX_DEPLOYMENT_TARGET="$MINVER")
  [ "$HOST_ARCH" = "$FF_ARCH" ] || CROSS=1
  VPX_TARGET="$([ "$FF_ARCH" = arm64 ] && echo arm64-darwin20-gcc || echo x86_64-darwin20-gcc)"
  X264_EXTRA=(--host="$TRIPLET")
  AUTOTOOLS_HOST=(--host="$TRIPLET")
  FF_CROSS_ARGS=(--target-os=darwin --arch="$FF_ARCH" --cc="$CC" --cxx="$CXX")
  [ "$CROSS" = 1 ] && FF_CROSS_ARGS+=(--enable-cross-compile)
  MESON_SYSTEM=darwin
  LIBRIST_EXTRA=()
  MESON_CPU="$FF_ARCH"
  MESON_C="['clang', '-arch', '$FF_ARCH', '-mmacosx-version-min=$MINVER']"
  MESON_LINK="['-arch', '$FF_ARCH', '-mmacosx-version-min=$MINVER']"
else
  CROSS=1
  export CC="$MINGW_CC" CXX="$MINGW_CXX"
  export AR=x86_64-w64-mingw32-ar RANLIB=x86_64-w64-mingw32-ranlib STRIP=x86_64-w64-mingw32-strip
  export RC=x86_64-w64-mingw32-windres
  cat > "$WORK/toolchain.cmake" <<EOF
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_C_COMPILER $MINGW_CC)
set(CMAKE_CXX_COMPILER $MINGW_CXX)
set(CMAKE_RC_COMPILER x86_64-w64-mingw32-windres)
set(CMAKE_FIND_ROOT_PATH $PREFIX)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
EOF
  CMAKE_ARGS+=(-DCMAKE_TOOLCHAIN_FILE="$WORK/toolchain.cmake")
  VPX_TARGET=x86_64-win64-gcc
  X264_EXTRA=(--host="$TRIPLET" --cross-prefix="$TRIPLET-")
  AUTOTOOLS_HOST=(--host="$TRIPLET")
  FF_CROSS_ARGS=(--enable-cross-compile --target-os=mingw32 --arch=x86_64 --cross-prefix="$TRIPLET-"
                 --cc="$MINGW_CC" --cxx="$MINGW_CXX")
  MESON_SYSTEM=windows
  # Use winpthreads' clock_gettime; otherwise librist's own shim redefines it and fails to compile.
  LIBRIST_EXTRA=(-Dhave_mingw_pthreads=true)
  MESON_CPU=x86_64
  MESON_C="['$MINGW_CC']"
  MESON_LINK="[]"
fi

log() { echo; echo "==> $*"; }

# fetch_git <dir> <url> <ref>
# Re-clones when the existing checkout is not at <ref>, so changing a pinned tag takes effect.
fetch_git() {
  if [ -d "$SRC/$1/.git" ]; then
    local cur
    cur="$(git -C "$SRC/$1" describe --tags --exact-match 2>/dev/null || git -C "$SRC/$1" rev-parse --abbrev-ref HEAD)"
    [ "$cur" = "$3" ] && return 0
    rm -rf "$SRC/$1"
  fi
  git clone --depth 1 --branch "$3" "$2" "$SRC/$1"
}
# fetch_tar <dir> <url>
# Downloads to a file first (tar only auto-detects gz/xz/bz2 on files, not pipes) and extracts into a temp dir that
# is moved into place on success, so a failed download never leaves an empty dir that later runs mistake for a source.
fetch_tar() {
  [ -n "$(ls -A "$SRC/$1" 2>/dev/null)" ] && return 0
  rm -rf "$SRC/$1" "$SRC/$1.tmp"
  mkdir -p "$SRC/$1.tmp"
  curl -fSL --retry 3 -o "$WORK/$1.archive" "$2"
  tar -xf "$WORK/$1.archive" --strip-components=1 -C "$SRC/$1.tmp"
  rm -f "$WORK/$1.archive"
  mv "$SRC/$1.tmp" "$SRC/$1"
}

# --- Dependencies ---
build_x264() {
  [ -f "$PREFIX/lib/libx264.a" ] && return
  log "x264"
  fetch_git x264 https://code.videolan.org/videolan/x264.git stable
  ( cd "$SRC/x264"
    ./configure --prefix="$PREFIX" --enable-static --disable-cli --disable-opencl --enable-pic "${X264_EXTRA[@]}"
    make -j"$JOBS" && make install )
}

build_libvpx() {
  [ -f "$PREFIX/lib/libvpx.a" ] && return
  log "libvpx"
  fetch_git libvpx https://chromium.googlesource.com/webm/libvpx "$LIBVPX_TAG"
  ( cd "$SRC/libvpx"
    ./configure --prefix="$PREFIX" --target="$VPX_TARGET" --disable-examples --disable-tools --disable-docs \
      --disable-unit-tests --enable-vp9-highbitdepth --enable-pic --disable-shared --enable-static
    make -j"$JOBS" && make install )
}

build_opus() {
  [ -f "$PREFIX/lib/libopus.a" ] && return
  log "opus"
  fetch_tar opus "https://downloads.xiph.org/releases/opus/opus-$OPUS_VER.tar.gz"
  ( cd "$SRC/opus"
    ./configure --prefix="$PREFIX" "${AUTOTOOLS_HOST[@]}" --disable-shared --enable-static --disable-doc --disable-extra-programs
    make -j"$JOBS" && make install )
}

build_lame() {
  [ -f "$PREFIX/lib/libmp3lame.a" ] && return
  log "lame"
  fetch_tar lame "https://downloads.sourceforge.net/project/lame/lame/$LAME_VER/lame-$LAME_VER.tar.gz"
  ( cd "$SRC/lame"
    ./configure --prefix="$PREFIX" "${AUTOTOOLS_HOST[@]}" --disable-shared --enable-static \
      --disable-frontend --disable-decoder --disable-gtktest
    make -j"$JOBS" && make install )
}

build_vorbis() {
  [ -f "$PREFIX/lib/libvorbisenc.a" ] && return
  log "libogg + libvorbis"
  fetch_tar ogg "https://downloads.xiph.org/releases/ogg/libogg-$OGG_VER.tar.xz"
  ( cd "$SRC/ogg"
    ./configure --prefix="$PREFIX" "${AUTOTOOLS_HOST[@]}" --disable-shared --enable-static
    make -j"$JOBS" && make install )
  fetch_tar vorbis "https://downloads.xiph.org/releases/vorbis/libvorbis-$VORBIS_VER.tar.xz"
  ( cd "$SRC/vorbis"
    ./configure --prefix="$PREFIX" "${AUTOTOOLS_HOST[@]}" --disable-shared --enable-static \
      --disable-docs --disable-examples --disable-oggtest
    make -j"$JOBS" && make install )
}

build_aom() {
  [ -f "$PREFIX/lib/libaom.a" ] && return
  log "libaom"
  fetch_git aom https://aomedia.googlesource.com/aom "$AOM_TAG"
  rm -rf "$WORK/build-aom"
  cmake -S "$SRC/aom" -B "$WORK/build-aom" "${CMAKE_ARGS[@]}" \
    -DENABLE_DOCS=0 -DENABLE_TESTS=0 -DENABLE_EXAMPLES=0 -DENABLE_TOOLS=0 -DENABLE_TESTDATA=0
  cmake --build "$WORK/build-aom" -j"$JOBS" && cmake --install "$WORK/build-aom"
}

build_svtav1() {
  [ -f "$PREFIX/lib/libSvtAv1Enc.a" ] && return
  log "SVT-AV1"
  fetch_git svtav1 https://gitlab.com/AOMediaCodec/SVT-AV1.git "$SVTAV1_TAG"
  rm -rf "$WORK/build-svtav1"
  cmake -S "$SRC/svtav1" -B "$WORK/build-svtav1" "${CMAKE_ARGS[@]}" \
    -DBUILD_APPS=OFF -DBUILD_DEC=OFF -DBUILD_TESTING=OFF
  cmake --build "$WORK/build-svtav1" -j"$JOBS" && cmake --install "$WORK/build-svtav1"
}

# mbedtls gives librist its AES encryption (screenstream passes -secret/-encryption).
build_mbedtls() {
  [ -f "$PREFIX/lib/libmbedtls.a" ] && return
  log "mbedtls"
  fetch_tar mbedtls "https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-$MBEDTLS_VER/mbedtls-$MBEDTLS_VER.tar.bz2"
  rm -rf "$WORK/build-mbedtls"
  cmake -S "$SRC/mbedtls" -B "$WORK/build-mbedtls" "${CMAKE_ARGS[@]}" \
    -DENABLE_TESTING=OFF -DENABLE_PROGRAMS=OFF -DMBEDTLS_FATAL_WARNINGS=OFF -DUSE_SHARED_MBEDTLS_LIBRARY=OFF -DUSE_STATIC_MBEDTLS_LIBRARY=ON
  cmake --build "$WORK/build-mbedtls" -j"$JOBS" && cmake --install "$WORK/build-mbedtls"
}

build_librist() {
  [ -f "$PREFIX/lib/librist.a" ] && return
  log "librist"
  fetch_git librist https://code.videolan.org/rist/librist.git "$LIBRIST_TAG"
  cat > "$WORK/meson-cross.ini" <<EOF
[binaries]
c = $MESON_C
pkg-config = 'pkg-config'
[built-in options]
c_link_args = $MESON_LINK
[host_machine]
system = '$MESON_SYSTEM'
cpu_family = '$MESON_CPU'
cpu = '$MESON_CPU'
endian = 'little'
EOF
  meson setup "$WORK/build-librist" "$SRC/librist" --cross-file "$WORK/meson-cross.ini" \
    --prefix="$PREFIX" --libdir=lib --buildtype=release --default-library=static \
    -Dbuiltin_cjson=true -Duse_mbedtls=true -Dbuiltin_mbedtls=false -Duse_nettle=false \
    -Dtest=false -Dbuilt_tools=false ${LIBRIST_EXTRA[@]+"${LIBRIST_EXTRA[@]}"}
  ninja -C "$WORK/build-librist" install
}

# Windows hardware encoders: header-only, nothing is linked, so no licence or static-link complications.
build_hwheaders() {
  [ "$PLATFORM" = win32 ] || return 0
  if [ ! -f "$PREFIX/lib/pkgconfig/ffnvcodec.pc" ]; then
    log "nv-codec-headers (NVENC)"
    fetch_git nvcodec https://git.videolan.org/git/ffmpeg/nv-codec-headers.git "$NVCODEC_TAG"
    make -C "$SRC/nvcodec" install PREFIX="$PREFIX"
  fi
  if [ ! -d "$PREFIX/include/AMF" ]; then
    log "AMF headers"
    fetch_git amf https://github.com/GPUOpen-LibrariesAndSDKs/AMF.git "$AMF_TAG"
    mkdir -p "$PREFIX/include/AMF"
    cp -R "$SRC/amf/amf/public/include/." "$PREFIX/include/AMF/"
  fi
}

# --- FFmpeg ---
fetch_ffmpeg() {
  local ver="${FFMPEG_VERSION:-}"
  if [ -z "$ver" ]; then
    ver="$(curl -fsSL https://ffmpeg.org/releases/ \
      | grep -oE 'ffmpeg-[0-9]+\.[0-9]+(\.[0-9]+)?\.tar\.xz' | sed -E 's/^ffmpeg-//; s/\.tar\.xz$//' | sort -uV | tail -1)"
  fi
  [ -n "$ver" ] || { echo "ERROR: could not determine the latest ffmpeg version." >&2; exit 1; }
  FFMPEG_VERSION="$ver"
  log "ffmpeg $ver (from ffmpeg.org)"
  fetch_tar ffmpeg "https://ffmpeg.org/releases/ffmpeg-$ver.tar.xz"
}

build_ffmpeg() {
  ( cd "$SRC/ffmpeg"
    make distclean &>/dev/null || true
    local extra_ld="-L$PREFIX/lib"
    [ "$PLATFORM" = win32 ] && extra_ld="$extra_ld -static"
    # --pkg-config=pkg-config: with --cross-prefix ffmpeg otherwise looks for <triplet>-pkg-config and, not finding it, disables
    # every library lookup. --pkg-config-flags=--static pulls in each library's private deps (mbedtls, ws2_32, libc++, ...).
    local hw=()
    # -lbcrypt: mbedtls (pulled in by librist) calls BCryptGenRandom, but its .pc file omits the library.
    if [ "$PLATFORM" = win32 ]; then hw=(--enable-ffnvcodec --enable-amf --extra-libs=-lbcrypt); else hw=(--enable-videotoolbox); fi
    ./configure --prefix="$PREFIX/ffmpeg-install" "${FF_CROSS_ARGS[@]}" "${hw[@]}" \
      --pkg-config=pkg-config --pkg-config-flags=--static --extra-cflags="-I$PREFIX/include" --extra-ldflags="$extra_ld" \
      --extra-version="$STAMP" \
      --enable-gpl --enable-version3 --disable-shared --enable-static --disable-doc --disable-ffplay \
      --enable-librist --enable-libx264 --enable-libvpx --enable-libaom --enable-libsvtav1 --enable-libopus \
      --enable-libmp3lame --enable-libvorbis
    make -j"$JOBS" && make install )
}

install_output() {
  local dest="$OUT/$PLATFORM/$ARCH" ext=""
  [ "$PLATFORM" = win32 ] && ext=".exe"
  mkdir -p "$dest"
  for b in ffmpeg ffprobe; do
    cp "$PREFIX/ffmpeg-install/bin/$b$ext" "$dest/$b$ext"
    if [ "$PLATFORM" = win32 ]; then "$STRIP" "$dest/$b$ext"; else strip -x "$dest/$b$ext"; fi
  done

  # Check RIST is really in the binary. Can't run a foreign binary, so fall back to inspecting its build string.
  # Output goes to a file/variable first: `... | grep -q` under pipefail fails when grep exits early (SIGPIPE).
  local ok=0 strs="$WORK/ffmpeg.strings" protocols
  strings -a "$dest/ffmpeg$ext" > "$strs"
  if [ "$CROSS" = 0 ] && [ "$PLATFORM" = darwin ]; then
    protocols="$("$dest/ffmpeg" -hide_banner -protocols 2>/dev/null || true)"
    grep -qx '  rist' <<<"$protocols" && ok=1
    { "$dest/ffmpeg" -version; "$dest/ffmpeg" -hide_banner -buildconf 2>/dev/null; } > "$dest/versions.txt" || true
  else
    grep -q -- '--enable-librist' "$strs" && ok=1
    { echo "ffmpeg $FFMPEG_VERSION (cross-built for $TARGET)"; grep -m1 -- '--enable-gpl' "$strs"; } > "$dest/versions.txt" || true
  fi
  [ "$ok" = 1 ] || { echo "ERROR: built ffmpeg has no RIST support; do not upload." >&2; exit 1; }
  echo "    RIST: ok"

  # Provenance, so a binary can be traced back to this build (BUILD_NOTE: e.g. the GitHub Actions run URL).
  grep -qF -- "$STAMP" "$strs" || { echo "ERROR: version stamp missing from the built ffmpeg." >&2; exit 1; }
  {
    echo "build-stamp: $STAMP"
    echo "built:       $(date -u +%Y-%m-%dT%H:%M:%SZ) on $(uname -sm)"
    echo "source:      revelation-electron-wrapper $APP_VERSION @ $GIT_COMMIT"
    [ -z "${BUILD_NOTE:-}" ] || echo "note:        $BUILD_NOTE"
    echo
    cat "$dest/versions.txt"
  } > "$dest/versions.txt.new" && mv "$dest/versions.txt.new" "$dest/versions.txt"

  # Hardware encoders: encoder names are embedded in the binary only when compiled in.
  local enc
  if [ "$PLATFORM" = win32 ]; then enc="h264_nvenc h264_amf"; else enc="h264_videotoolbox"; fi
  for e in $enc; do
    grep -qx "$e" "$strs" || { echo "ERROR: built ffmpeg lacks $e; do not upload." >&2; exit 1; }
    echo "    $e: ok"
  done
  echo "    Done -> $dest"
}

build_x264
build_libvpx
build_opus
build_lame
build_vorbis
build_aom
build_svtav1
build_mbedtls
build_librist
build_hwheaders
fetch_ffmpeg
build_ffmpeg
install_output
