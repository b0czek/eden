import { render } from "solid-js/web";
import Shell from "./components/Shell";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

render(() => <Shell />, root);
