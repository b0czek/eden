import type { Component } from "solid-js";
import { onMount } from "solid-js";
import UsersTab from "./components/users/UsersTab";
import { initLocale } from "./i18n";
import "./App.css";

const App: Component = () => {
  onMount(() => initLocale());

  return (
    <div class="users-app">
      <UsersTab />
    </div>
  );
};

export default App;
