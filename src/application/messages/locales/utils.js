const stripAt = (value) =>
  typeof value === "string" ? value.replace(/^@+/, "") : value;

export { stripAt };

