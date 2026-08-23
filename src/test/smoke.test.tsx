// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import "./setup";

test("the component test harness renders and asserts", () => {
  render(<p>grid is clean</p>);
  expect(screen.getByText("grid is clean")).toBeInTheDocument();
});
