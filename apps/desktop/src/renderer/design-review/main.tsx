import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesignReview } from "./review";
import "./review.css";

const root = document.getElementById("root");
if (!root) throw new Error("DESIGN_REVIEW_ROOT_MISSING");
createRoot(root).render(
  <StrictMode>
    <DesignReview />
  </StrictMode>,
);
