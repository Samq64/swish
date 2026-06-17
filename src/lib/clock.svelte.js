/**
 * A single shared "now" ticker (minutes from midnight), so every DayColumn
 * reads one reactive value instead of each spinning up its own interval.
 * Ref-counted: the interval runs only while at least one component is using it.
 */
function nowMinute() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

class Clock {
  minute = $state(nowMinute());
  /** @type {ReturnType<typeof setInterval> | null} */
  #timer = null;
  #refs = 0;

  /** Use inside an $effect: `$effect(() => clock.subscribe());` */
  subscribe() {
    if (this.#refs++ === 0) {
      this.#timer = setInterval(() => (this.minute = nowMinute()), 30_000);
    }
    return () => {
      if (--this.#refs === 0 && this.#timer != null) {
        clearInterval(this.#timer);
        this.#timer = null;
      }
    };
  }
}

export const clock = new Clock();
