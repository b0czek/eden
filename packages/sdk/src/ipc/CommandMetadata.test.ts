import {
  addCommandHandler,
  getManagerMetadata,
  setManagerNamespace,
} from "./CommandMetadata";

describe("CommandMetadata", () => {
  it("stores namespaces and handlers per manager class", () => {
    class ManagerA {
      handler(): void {}
    }

    class ManagerB {
      other(): void {}
    }

    setManagerNamespace(ManagerA, "alpha");
    addCommandHandler(ManagerA, "command.one", "handler");
    setManagerNamespace(ManagerB, "beta");
    addCommandHandler(ManagerB, "command.two", "other");

    const metaA = getManagerMetadata(new ManagerA());
    const metaB = getManagerMetadata(new ManagerB());

    expect(metaA?.namespace).toBe("alpha");
    expect(metaA?.handlers.get("command.one")).toBe("handler");

    expect(metaB?.namespace).toBe("beta");
    expect(metaB?.handlers.get("command.two")).toBe("other");
  });

  it("updates an existing namespace without losing handlers", () => {
    class ManagerC {
      handle(): void {}
    }

    setManagerNamespace(ManagerC, "initial");
    addCommandHandler(ManagerC, "command.three", "handle");
    setManagerNamespace(ManagerC, "updated");

    const metaC = getManagerMetadata(new ManagerC());
    expect(metaC?.namespace).toBe("updated");
    expect(metaC?.handlers.get("command.three")).toBe("handle");
  });
});
