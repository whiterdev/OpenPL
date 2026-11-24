// Plantillas de "Nuevo". Sintaxis Oracle genérica; el usuario cambia los nombres.

export interface NewWindowTemplate {
  /** Texto del menú Nuevo. */
  menu: string;
  /** Título de la pestaña. */
  label: string;
  parts: { kind: string; source: string }[];
}

export const newWindowTemplates: NewWindowTemplate[] = [
  { menu: "Programa en blanco", label: "Programa", parts: [{ kind: "SQL", source: "" }] },
  {
    menu: "Paquete", label: "Paquete nuevo", parts: [
      { kind: "PACKAGE", source: "CREATE OR REPLACE PACKAGE nuevo_paquete AS\n\nEND nuevo_paquete;\n" },
      { kind: "PACKAGE BODY", source: "CREATE OR REPLACE PACKAGE BODY nuevo_paquete AS\n\nEND nuevo_paquete;\n" },
    ],
  },
  {
    menu: "Procedimiento", label: "Procedimiento nuevo", parts: [{
      kind: "PROCEDURE",
      source: "CREATE OR REPLACE PROCEDURE nuevo_procedimiento IS\nBEGIN\n  NULL;\nEND nuevo_procedimiento;\n",
    }],
  },
  {
    menu: "Función", label: "Función nueva", parts: [{
      kind: "FUNCTION",
      source: "CREATE OR REPLACE FUNCTION nueva_funcion RETURN NUMBER IS\nBEGIN\n  RETURN NULL;\nEND nueva_funcion;\n",
    }],
  },
  {
    menu: "Trigger", label: "Trigger nuevo", parts: [{
      kind: "TRIGGER",
      source: "CREATE OR REPLACE TRIGGER nuevo_trigger\n  BEFORE INSERT ON nombre_tabla\n  FOR EACH ROW\nBEGIN\n  NULL;\nEND nuevo_trigger;\n",
    }],
  },
  {
    menu: "Tipo", label: "Tipo nuevo", parts: [
      { kind: "TYPE", source: "CREATE OR REPLACE TYPE nuevo_tipo AS OBJECT (\n  id NUMBER\n);\n" },
      { kind: "TYPE BODY", source: "CREATE OR REPLACE TYPE BODY nuevo_tipo AS\n\nEND;\n" },
    ],
  },
  {
    menu: "Vista", label: "Vista nueva", parts: [{
      kind: "SQL", source: "CREATE OR REPLACE VIEW nueva_vista AS\nSELECT *\nFROM nombre_tabla;\n",
    }],
  },
];
