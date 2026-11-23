use openpl_core::catalog::ObjectType;
use openpl_core::program::{program_kinds, source_text};

#[test]
fn mapea_paquetes_y_rechaza_tablas() {
    assert_eq!(
        program_kinds(ObjectType::Package),
        &["PACKAGE", "PACKAGE BODY"]
    );
    assert_eq!(program_kinds(ObjectType::Type), &["TYPE", "TYPE BODY"]);
    assert!(program_kinds(ObjectType::Table).is_empty());
}

#[test]
fn conserva_lineas_y_terminador() {
    assert_eq!(
        source_text(["PACKAGE \"Mi Paquete\" AS\r\n", "\n", "END;"]),
        "CREATE OR REPLACE PACKAGE \"Mi Paquete\" AS\n\nEND;\n"
    );
}
