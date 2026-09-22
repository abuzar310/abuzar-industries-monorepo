/** Fat-finger / phone: coarse pointer or the same 760px cut the rest of Cut Size uses. */
export function isPhone(width: number, coarse: boolean): boolean {
  return coarse || width <= 760;
}

export function phoneNow(): boolean {
  if (typeof window === "undefined") return false;
  return isPhone(window.innerWidth, window.matchMedia("(pointer: coarse)").matches);
}
