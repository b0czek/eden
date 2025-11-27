import { render } from "solid-js/web";
import ShellOverlay from "./components/ShellOverlay";
import "../design-system/eden.css";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

render(() => <ShellOverlay />, root);

