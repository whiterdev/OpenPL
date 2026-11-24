use openpl_core::routine::{group_overloads, ArgumentRow, RoutineRow};

fn argument(id: u32, sequence: u32, position: u32, depth: u32, name: Option<&str>) -> RoutineRow {
    RoutineRow {
        subprogram_id: id,
        overload: Some(id.to_string()),
        argument: Some(ArgumentRow {
            sequence,
            position,
            depth,
            name: name.map(str::to_owned),
            data_type: "NUMBER".into(),
            direction: Some("IN".into()),
            defaulted: false,
            type_owner: None,
            type_name: None,
            type_subname: None,
        }),
    }
}

#[test]
fn agrupa_sobrecargas_con_retorno_campos_y_parametros_por_posicion() {
    let empty = RoutineRow {
        subprogram_id: 2,
        overload: Some("2".into()),
        argument: None,
    };
    let signatures = group_overloads([
        argument(1, 4, 2, 0, Some("P_CODIGO")),
        argument(1, 1, 0, 0, None),
        empty,
        argument(1, 3, 1, 1, Some("ATRIBUTO")),
        argument(1, 2, 1, 0, Some("P_REGISTRO")),
    ]);
    assert_eq!(signatures.len(), 2);
    assert_eq!(
        signatures[0].returns.as_ref().unwrap().declaration.position,
        0
    );
    assert_eq!(
        signatures[0]
            .parameters
            .iter()
            .map(|param| param.declaration.name.as_deref().unwrap())
            .collect::<Vec<_>>(),
        ["P_REGISTRO", "P_CODIGO"]
    );
    assert_eq!(
        signatures[0].parameters[0].fields[0].name.as_deref(),
        Some("ATRIBUTO")
    );
    assert!(signatures[1].parameters.is_empty());
    assert!(signatures[1].returns.is_none());
}
