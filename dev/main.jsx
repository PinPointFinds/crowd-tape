import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import CrowdTape from "../crowd-tape.jsx";

// A thrown render would otherwise leave a blank page with the reason only in
// the console — put it on screen instead.
class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err) {
    console.error("CrowdTape threw:", err);
  }
  render() {
    if (this.state.err) {
      return (
        <pre
          style={{
            color: "#FF4D67",
            background: "#0A0F1C",
            padding: 24,
            fontSize: 13,
            whiteSpace: "pre-wrap",
          }}
        >
          {String(this.state.err.stack || this.state.err)}
        </pre>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <Boundary>
    <CrowdTape />
  </Boundary>
);
