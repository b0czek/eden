import type { Component } from "solid-js";

interface FileGraphicProps {
  src: string;
}

const FileGraphic: Component<FileGraphicProps> = (props) => (
  <img class="file-graphic" src={props.src} alt="" aria-hidden="true" />
);

export { FileGraphic };
export default FileGraphic;
