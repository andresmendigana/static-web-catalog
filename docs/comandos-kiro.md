# Operaciones Kiro del workflow

Este documento registra las operaciones de Kiro usadas o relevantes para el workflow de documentación y ejecución de OpenSpec. Cada operación se documenta una sola vez, con una explicación breve y con su resultado real; no se deben registrar como exitosas las operaciones canceladas o fallidas.

## Operaciones de contexto y exploración

- **`disclose_context`**: activa explícitamente una skill o una regla steering disponible para la sesión. Sirve para incorporar sus instrucciones antes de realizar el trabajo que corresponda.
- **`read_file` / `read_files`**: leen uno o varios archivos para conocer requisitos, diseño, tareas, configuración y convenciones antes de actuar. `read_file` se usa para un archivo; `read_files` permite leer varios o rangos de líneas.
- **`list_directory`**: explora una ruta y muestra sus archivos y carpetas para localizar el contexto o confirmar la estructura de un proyecto.

## Operaciones de delegación y tareas

- **`invoke_sub_agent`**: delega una actividad concreta a un agente especializado. La delegación debe indicar:
  - **`name`**: nombre del agente que realizará el trabajo.
  - **`explanation`**: motivo breve de la delegación y cómo contribuye al objetivo.
  - **`prompt`**: instrucciones completas y específicas para el agente.
  - **`contextFiles`**: archivos relevantes, opcionalmente con rangos de líneas, que el agente necesita consultar.

  Una delegación cancelada no equivale a una ejecución completada. Si el agente no terminó el trabajo, la delegación debe registrarse como **cancelada**, no como comando ejecutado exitosamente; tampoco se debe marcar como completada la tarea que dependía de ella.
- **`task_list`**: consulta o mantiene el seguimiento de las tareas del workflow, sus estados y el contexto asociado.
- **`task_update`**: actualiza el estado de una tarea cuando existe evidencia del resultado correspondiente. Una tarea solo se marca como completada después de terminarla y verificarla; una tarea cancelada o fallida conserva ese estado y requiere una decisión posterior.
- **`validate_spec_format`**: valida que los artefactos de especificación respeten el formato esperado antes de considerarlos listos para continuar. La validación de formato no sustituye la revisión del contenido ni la ejecución de las tareas.

## Kiro frente al CLI `openspec`

Una **llamada de herramienta Kiro** es una operación gestionada por el entorno de Kiro, como leer contexto, activar reglas, delegar trabajo o actualizar el seguimiento de tareas. Su resultado debe registrarse según lo que realmente ocurrió: ejecutado, cancelado o fallido.

El **CLI `openspec`** es un programa externo que se ejecuta desde una terminal para operar sobre cambios, specs o instrucciones del repositorio. No es una herramienta Kiro: sus comandos, salida y errores pertenecen al registro de comandos del proyecto y solo deben documentarse si se ejecutaron realmente. Una llamada Kiro puede coordinar el workflow, pero no debe presentarse como si fuera una ejecución del CLI `openspec`.

## Regla de no duplicación

- Los comandos de **PowerShell y Node.js** permanecen en [`docs/comandos-implementacion.md`](comandos-implementacion.md).
- Las operaciones de **Kiro** quedan en este documento.
- No se copia una misma operación entre ambos documentos ni se inventan comandos que no se hayan usado. Si una operación fue cancelada o falló, se registra con ese resultado y no como éxito.
