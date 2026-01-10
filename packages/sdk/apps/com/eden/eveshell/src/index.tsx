import { render } from "solid-js/web";
import ShellOverlay from "./components/ShellOverlay";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

render(() => <ShellOverlay />, root);
