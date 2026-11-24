import type { ObjectInfo, ObjectType } from "./types";

type ObjectName = Pick<ObjectInfo, "name" | "owner" | "object_type">;
export type DraftAction = "create" | "rename" | "drop" | "account" | "privileges";
const identifier = (name: string) => '"' + name.replace(/"/g, '""') + '"';
const qualified = ({ owner, name }: ObjectName) => owner ? identifier(owner) + "." + identifier(name) : identifier(name);
const globalKinds: Partial<Record<ObjectType, string>> = {
  User: "USER", Role: "ROLE", Profile: "PROFILE", Tablespace: "TABLESPACE", Directory: "DIRECTORY",
};
const schemaKinds: Partial<Record<ObjectType, string>> = {
  Table: "TABLE", View: "VIEW", MaterializedView: "MATERIALIZED VIEW", Sequence: "SEQUENCE",
  Synonym: "SYNONYM", Index: "INDEX", Package: "PACKAGE", Procedure: "PROCEDURE", Function: "FUNCTION",
  Type: "TYPE", Trigger: "TRIGGER", Cluster: "CLUSTER",
};
const templates: Partial<Record<ObjectType, string>> = {
  Table: "CREATE TABLE NOMBRE (ID NUMBER PRIMARY KEY);",
  View: "CREATE VIEW NOMBRE AS\nSELECT 1 AS ID FROM DUAL;",
  MaterializedView: "CREATE MATERIALIZED VIEW NOMBRE AS\nSELECT 1 AS ID FROM DUAL;",
  Sequence: "CREATE SEQUENCE NOMBRE START WITH 1 INCREMENT BY 1;",
  Synonym: "CREATE SYNONYM NOMBRE FOR ESQUEMA.OBJETO;",
  Index: "CREATE INDEX NOMBRE ON TABLA (COLUMNA);",
  Package: "CREATE OR REPLACE PACKAGE NOMBRE AS\n  PROCEDURE EJEMPLO;\nEND NOMBRE;",
  Procedure: "CREATE OR REPLACE PROCEDURE NOMBRE AS\nBEGIN\n  NULL;\nEND;",
  Function: "CREATE OR REPLACE FUNCTION NOMBRE RETURN NUMBER AS\nBEGIN\n  RETURN 0;\nEND;",
  Type: "CREATE OR REPLACE TYPE NOMBRE AS OBJECT (ID NUMBER);",
  Trigger: "CREATE OR REPLACE TRIGGER NOMBRE\nBEFORE UPDATE ON TABLA\nBEGIN\n  NULL;\nEND;",
  User: "CREATE USER NOMBRE IDENTIFIED EXTERNALLY;",
  Role: "CREATE ROLE NOMBRE;",
  Profile: "CREATE PROFILE NOMBRE LIMIT SESSIONS_PER_USER DEFAULT;",
  Directory: "CREATE DIRECTORY NOMBRE AS '/ruta';",
  Cluster: "CREATE CLUSTER NOMBRE (ID NUMBER);",
};

export const createDraft = (type: ObjectType) => templates[type];
export const canRename = (type: ObjectType) => type === "Table" || type === "Index";

export function renameDraft(object: ObjectName, name: string) {
  if (!canRename(object.object_type) || !name.trim()) return;
  return "ALTER " + schemaKinds[object.object_type] + " " + qualified(object) + " RENAME TO " + identifier(name.trim()) + ";";
}

export function dropDraft(object: ObjectName) {
  const global = globalKinds[object.object_type];
  const kind = global ?? schemaKinds[object.object_type];
  if (!kind || (object.object_type === "Synonym" && object.owner === "PUBLIC")) return;
  return "DROP " + kind + " " + (global ? identifier(object.name) : qualified(object)) + ";";
}

export function accountDraft(object: ObjectName, lock: boolean) {
  return "ALTER USER " + identifier(object.name) + " ACCOUNT " + (lock ? "LOCK" : "UNLOCK") + ";";
}

export function privilegesQuery(name: string) {
  const grantee = "'" + name.replace(/'/g, "''") + "'";
  return [
    "SELECT 'Rol' AS TIPO, NULL AS ESQUEMA, NULL AS OBJETO, GRANTED_ROLE AS PERMISO, ADMIN_OPTION AS DELEGABLE",
    "FROM SYS.DBA_ROLE_PRIVS WHERE GRANTEE = " + grantee,
    "UNION ALL",
    "SELECT 'Sistema', NULL, NULL, PRIVILEGE, ADMIN_OPTION",
    "FROM SYS.DBA_SYS_PRIVS WHERE GRANTEE = " + grantee,
    "UNION ALL",
    "SELECT 'Objeto', OWNER, TABLE_NAME, PRIVILEGE, GRANTABLE",
    "FROM SYS.DBA_TAB_PRIVS WHERE GRANTEE = " + grantee,
    "ORDER BY 1, 2, 3, 4",
  ].join("\n");
}
