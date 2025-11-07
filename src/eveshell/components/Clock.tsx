import { createSignal, onCleanup } from "solid-js";

export default function Clock() {
  const [time, setTime] = createSignal(new Date());

  const interval = setInterval(() => {
    setTime(new Date());
  }, 1000);

  onCleanup(() => clearInterval(interval));

  const formatTime = () => {
    const t = time();
    return t.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDate = () => {
    const t = time();
    return t.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div class="clock">
      <div class="time">{formatTime()}</div>
      <div class="date">{formatDate()}</div>
    </div>
  );
}
