import type { Component } from "solid-js";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { initLocale, t } from "./i18n";

// App constants
const APP_ID = "com.eden.calculator";
const SCIENTIFIC_THRESHOLD = 550;

type AngleUnit = "deg" | "rad";

const App: Component = () => {
  // Calculator state
  const [display, setDisplay] = createSignal("0");
  const [expression, setExpression] = createSignal("");
  const [previousInput, setPreviousInput] = createSignal<string | null>(null);
  const [operator, setOperator] = createSignal<string | null>(null);
  const [shouldReset, setShouldReset] = createSignal(false);
  const [pendingScientificOp, setPendingScientificOp] = createSignal<
    string | null
  >(null);

  // Settings state / Mode state
  const [isScientificMode, setIsScientificMode] = createSignal(false);
  const [angleUnit, setAngleUnit] = createSignal<AngleUnit>("deg");

  // Block zoom with Ctrl/Cmd + and Ctrl/Cmd -
  const handleKeyDown = (e: KeyboardEvent) => {
    // Block zoom
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === "+" || e.key === "-" || e.key === "=")
    ) {
      e.preventDefault();
      return;
    }

    // Calculator keyboard shortcuts
    if (e.key >= "0" && e.key <= "9") {
      appendNumber(e.key);
    } else if (e.key === ".") {
      appendNumber(".");
    } else if (e.key === "+") {
      appendOperator("+");
    } else if (e.key === "-") {
      appendOperator("-");
    } else if (e.key === "*") {
      appendOperator("*");
    } else if (e.key === "/") {
      appendOperator("/");
    } else if (e.key === "%") {
      appendOperator("%");
    } else if (e.key === "Enter" || e.key === "=") {
      calculate();
    } else if (e.key === "Backspace") {
      deleteLast();
    } else if (e.key === "Escape" || e.key === "Delete") {
      clearAll();
    }
  };

  // Block wheel zoom
  const handleWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
    }
  };

  onMount(async () => {
    await initLocale();

    // Add event listeners
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("wheel", handleWheel, { passive: false });

    // window resize handling for scientific mode
    const checkSize = () => {
      setIsScientificMode(window.innerHeight >= SCIENTIFIC_THRESHOLD);
    };

    // Initial check
    checkSize();

    // Listen for resize
    window.addEventListener("resize", checkSize);

    // Subscribe to settings changes
    if (window.edenAPI) {
      try {
        await window.edenAPI.subscribe(
          "settings/changed",
          handleSettingsChanged,
        );

        // Load initial settings
        await loadSettings();
      } catch (error) {
        console.error("Failed to initialize:", error);
      }
    }

    onCleanup(() => {
      window.removeEventListener("resize", checkSize);
    });
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
    document.removeEventListener("wheel", handleWheel);
  });

  const loadSettings = async () => {
    if (!window.edenAPI) return;

    try {
      // scientificMode setting is removed, handled by window size now

      const angleResult = await window.edenAPI.shellCommand("settings/get", {
        key: "angleUnit",
      });
      if (angleResult.value === "rad" || angleResult.value === "deg") {
        setAngleUnit(angleResult.value);
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  };

  const handleSettingsChanged = (data: {
    appId: string;
    key: string;
    value: string;
  }) => {
    if (data.appId !== APP_ID) return;

    if (data.key === "angleUnit") {
      if (data.value === "rad" || data.value === "deg") {
        setAngleUnit(data.value);
      }
    }
  };

  // Calculator logic
  const appendNumber = (num: string) => {
    const current = display();

    // Handle constants
    if (num.length > 1 && !num.includes(".")) {
      setDisplay(num);
      setShouldReset(true);
      return;
    }

    if (shouldReset()) {
      setDisplay(num === "." ? "0." : num);
      setShouldReset(false);
    } else {
      if (current === "0" && num !== ".") {
        setDisplay(num);
      } else if (num === "." && current.includes(".")) {
        return;
      } else if (current.length >= 15) {
        return;
      } else {
        setDisplay(current + num);
      }
    }
  };

  const appendOperator = (op: string) => {
    if (pendingScientificOp() === "pow") {
      setExpression(`${previousInput()}^`);
      setPendingScientificOp(null);
    }

    if (operator() !== null && !shouldReset()) {
      calculate();
    }

    const opSymbols: Record<string, string> = {
      "+": "+",
      "-": "−",
      "*": "×",
      "/": "÷",
      "%": "mod",
    };

    setExpression(`${display()} ${opSymbols[op] || op}`);
    setPreviousInput(display());
    setOperator(op);
    setShouldReset(true);
  };

  const calculate = () => {
    // Handle power operation
    if (pendingScientificOp() === "pow" && previousInput() !== null) {
      const base = parseFloat(previousInput()!);
      const exp = parseFloat(display());
      setDisplay(formatResult(base ** exp));
      setExpression(`${previousInput()}^${exp} =`);
      setPendingScientificOp(null);
      setPreviousInput(null);
      setShouldReset(true);
      return;
    }

    if (operator() === null || previousInput() === null) return;

    const prev = parseFloat(previousInput()!);
    const current = parseFloat(display());
    let result: number;

    const opSymbols: Record<string, string> = {
      "+": "+",
      "-": "−",
      "*": "×",
      "/": "÷",
      "%": "mod",
    };

    setExpression(
      `${previousInput()} ${opSymbols[operator()!]} ${display()} =`,
    );

    switch (operator()) {
      case "+":
        result = prev + current;
        break;
      case "-":
        result = prev - current;
        break;
      case "*":
        result = prev * current;
        break;
      case "/":
        if (current === 0) {
          setDisplay(t("common.error"));
          setExpression(t("calculator.divByZero"));
          setOperator(null);
          setPreviousInput(null);
          setShouldReset(true);
          return;
        }
        result = prev / current;
        break;
      case "%":
        result = prev % current;
        break;
      default:
        return;
    }

    setDisplay(formatResult(result));
    setOperator(null);
    setPreviousInput(null);
    setShouldReset(true);
  };

  const formatResult = (result: number): string => {
    if (!isFinite(result)) return t("common.error");
    if (Number.isInteger(result) && Math.abs(result) < 1e15) {
      return result.toString();
    }
    const rounded = Math.round(result * 1e12) / 1e12;
    return rounded.toString();
  };

  const clearAll = () => {
    setDisplay("0");
    setExpression("");
    setOperator(null);
    setPreviousInput(null);
    setShouldReset(false);
    setPendingScientificOp(null);
  };

  const deleteLast = () => {
    const current = display();
    if (current === t("common.error")) {
      clearAll();
      return;
    }
    if (current.length > 1) {
      setDisplay(current.slice(0, -1));
    } else {
      setDisplay("0");
    }
  };

  const toggleSign = () => {
    const current = display();
    if (current !== "0" && current !== t("common.error")) {
      if (current.startsWith("-")) {
        setDisplay(current.slice(1));
      } else {
        setDisplay(`-${current}`);
      }
    }
  };

  // Scientific functions
  const applyScientific = (func: string) => {
    const value = parseFloat(display());
    let result: number;

    // Convert to radians if needed for trig functions
    const toRadians = (deg: number) => (deg * Math.PI) / 180;
    const useRadians = angleUnit() === "rad";

    switch (func) {
      case "sin":
        result = Math.sin(useRadians ? value : toRadians(value));
        setExpression(`sin(${value}${useRadians ? "" : "°"})`);
        break;
      case "cos":
        result = Math.cos(useRadians ? value : toRadians(value));
        setExpression(`cos(${value}${useRadians ? "" : "°"})`);
        break;
      case "tan":
        result = Math.tan(useRadians ? value : toRadians(value));
        setExpression(`tan(${value}${useRadians ? "" : "°"})`);
        break;
      case "log":
        if (value <= 0) {
          setDisplay(t("common.error"));
          setExpression(t("calculator.invalidInput"));
          return;
        }
        result = Math.log10(value);
        setExpression(`log(${value})`);
        break;
      case "ln":
        if (value <= 0) {
          setDisplay(t("common.error"));
          setExpression(t("calculator.invalidInput"));
          return;
        }
        result = Math.log(value);
        setExpression(`ln(${value})`);
        break;
      case "sqrt":
        if (value < 0) {
          setDisplay(t("common.error"));
          setExpression(t("calculator.invalidInput"));
          return;
        }
        result = Math.sqrt(value);
        setExpression(`√${value}`);
        break;
      case "pow2":
        result = value ** 2;
        setExpression(`${value}²`);
        break;
      case "pow":
        setPreviousInput(display());
        setPendingScientificOp("pow");
        setExpression(`${value}^`);
        setShouldReset(true);
        return;
      case "inv":
        if (value === 0) {
          setDisplay(t("common.error"));
          setExpression(t("calculator.divByZero"));
          return;
        }
        result = 1 / value;
        setExpression(`1/${value}`);
        break;
      case "abs":
        result = Math.abs(value);
        setExpression(`|${value}|`);
        break;
      case "factorial":
        if (value < 0 || !Number.isInteger(value) || value > 170) {
          setDisplay(t("common.error"));
          setExpression(t("calculator.invalidInput"));
          return;
        }
        result = factorial(value);
        setExpression(`${value}!`);
        break;
      case "mod":
        appendOperator("%");
        return;
      default:
        return;
    }

    setDisplay(formatResult(result));
    setShouldReset(true);
  };

  const factorial = (n: number): number => {
    if (n === 0 || n === 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) {
      result *= i;
    }
    return result;
  };

  // Button definitions
  const scientificButtons = [
    [
      { label: "sin", action: () => applyScientific("sin") },
      { label: "cos", action: () => applyScientific("cos") },
      { label: "tan", action: () => applyScientific("tan") },
      { label: "log", action: () => applyScientific("log") },
      { label: "ln", action: () => applyScientific("ln") },
    ],
    [
      { label: "√", action: () => applyScientific("sqrt") },
      { label: "x²", action: () => applyScientific("pow2") },
      { label: "xʸ", action: () => applyScientific("pow") },
      { label: "π", action: () => appendNumber(Math.PI.toString()) },
      { label: "e", action: () => appendNumber(Math.E.toString()) },
    ],
    [
      { label: "1/x", action: () => applyScientific("inv") },
      { label: "|x|", action: () => applyScientific("abs") },
      { label: "n!", action: () => applyScientific("factorial") },
      { label: "mod", action: () => applyScientific("mod") },
      { label: "±", action: () => toggleSign() },
    ],
  ];

  return (
    <div class="calculator">
      {/* Display */}
      <div class="display-container eden-card">
        <div class="display-expression eden-text-secondary eden-text-sm">
          {expression()}
        </div>
        <div class="display-value">{display()}</div>
      </div>

      {/* Scientific buttons */}
      <Show when={isScientificMode()}>
        <div class="scientific-grid">
          <For each={scientificButtons}>
            {(row) => (
              <For each={row}>
                {(btn) => (
                  <button
                    class="eden-btn eden-btn-secondary eden-btn-sm sci-btn"
                    onClick={btn.action}
                  >
                    {btn.label}
                  </button>
                )}
              </For>
            )}
          </For>
        </div>
      </Show>

      {/* Main buttons */}
      <div class="buttons-grid">
        <button class="eden-btn eden-btn-danger" onClick={clearAll}>
          C
        </button>
        <button class="eden-btn eden-btn-secondary" onClick={deleteLast}>
          ⌫
        </button>
        <button
          class="eden-btn eden-btn-secondary"
          onClick={() => appendOperator("%")}
        >
          %
        </button>
        <button
          class="eden-btn eden-btn-primary"
          onClick={() => appendOperator("/")}
        >
          ÷
        </button>

        <button
          class="eden-btn eden-btn-ghost num-btn"
          onClick={() => appendNumber("7")}
        >
          7
        </button>
        <button
          class="eden-btn eden-btn-ghost num-btn"
          onClick={() => appendNumber("8")}
        >
          8
        </button>
        <button
          class="eden-btn eden-btn-ghost num-btn"
          onClick={() => appendNumber("9")}
        >
          9
        </button>
        <button
          class="eden-btn eden-btn-primary"
          onClick={() => appendOperator("*")}
        >
          ×
        </button>

        <button
          class="eden-btn eden-btn-ghost num-btn"
          onClick={() => appendNumber("4")}
        >
          4
        </button>
        <button
          class="eden-btn eden-btn-ghost num-btn"
          onClick={() => appendNumber("5")}
        >
          5
        </button>
        <button
          class="eden-btn eden-btn-ghost num-btn"
          onClick={() => appendNumber("6")}
        >
          6
        </button>
        <button
          class="eden-btn eden-btn-primary"
          onClick={() => appendOperator("-")}
        >
          −
        </button>

        <button
          class="eden-btn eden-btn-ghost num-btn"
          onClick={() => appendNumber("1")}
        >
          1
        </button>
        <button
          class="eden-btn eden-btn-ghost num-btn"
          onClick={() => appendNumber("2")}
        >
          2
        </button>
        <button
          class="eden-btn eden-btn-ghost num-btn"
          onClick={() => appendNumber("3")}
        >
          3
        </button>
        <button
          class="eden-btn eden-btn-primary"
          onClick={() => appendOperator("+")}
        >
          +
        </button>

        <button
          class="eden-btn eden-btn-ghost num-btn zero-btn"
          onClick={() => appendNumber("0")}
        >
          0
        </button>
        <button
          class="eden-btn eden-btn-ghost num-btn"
          onClick={() => appendNumber(".")}
        >
          .
        </button>
        <button
          class="eden-btn eden-btn-success equals-btn"
          onClick={calculate}
        >
          =
        </button>
      </div>
    </div>
  );
};

export default App;
