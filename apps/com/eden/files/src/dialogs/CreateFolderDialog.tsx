import { createSignal } from "solid-js";
import type { Component } from "solid-js";
import Modal from "../components/Modal";

interface CreateFolderDialogProps {
  show: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}

const CreateFolderDialog: Component<CreateFolderDialogProps> = (props) => {
  const [folderName, setFolderName] = createSignal("");

  const handleCreate = () => {
    props.onCreate(folderName());
    setFolderName("");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") {
      props.onClose();
      setFolderName("");
    }
  };

  return (
    <Modal
      show={props.show}
      onClose={() => {
        props.onClose();
        setFolderName("");
      }}
      title="Create New Folder"
      size="sm"
      footer={
        <>
          <button
            class="eden-btn"
            onClick={() => {
              props.onClose();
              setFolderName("");
            }}
          >
            Cancel
          </button>
          <button class="eden-btn eden-btn-primary" onClick={handleCreate}>
            Create
          </button>
        </>
      }
    >
      <div class="eden-form-group">
        <label class="eden-form-label">Folder Name</label>
        <input
          type="text"
          class="eden-input"
          placeholder="Enter folder name..."
          value={folderName()}
          onInput={(e) => setFolderName(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </Modal>
  );
};

export default CreateFolderDialog;
