/* @refresh reload */
import { render } from "solid-js/web";
import "simple-keyboard/build/css/index.css";
import App from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (root) {
  render(() => <App />, root);
}
