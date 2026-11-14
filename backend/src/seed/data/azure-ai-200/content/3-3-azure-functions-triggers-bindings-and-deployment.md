---
version: 1.0
updatedAt: 2026-11-14
---
# Azure Functions: Triggers, Bindings, Configuration and Deployment

> Exam domain: **Connect to and consume Azure services (20-25%)**, skill group *Develop and implement Azure Functions*.

---

## Triggers and bindings

A function is a piece of code plus the **declaration of how it is invoked and what data it touches**.

| Kind | Direction | Rule |
|------|-----------|------|
| **Trigger** | in | **Exactly one** per function. It starts the function and supplies its payload |
| **Input binding** | `in` | Reads data (a blob, a Cosmos DB item) into a parameter. Optional |
| **Output binding** | `out` | Writes the return value or a parameter to a service (a queue message, a blob). Optional |

You can have many bindings but **only one trigger**. Bindings replace SDK boilerplate, but you can still use the SDK in code when you need full control.

Common triggers: **HTTP**, **Timer**, **Service Bus** (queue or topic), **Event Grid**, **Blob**, **Cosmos DB** (change feed), **Event Hubs**, **Queue Storage**.

---

## Python v2 programming model

All functions live in `function_app.py` and are declared with decorators:

```python
import json
import azure.functions as func

app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)

# HTTP trigger: a serverless API
@app.route(route="orders/{order_id}", methods=["GET"])
@app.cosmos_db_input(arg_name="order", database_name="shop", container_name="orders",
                     connection="CosmosDbConnection",
                     id="{order_id}", partition_key="{Query.customer}")
def get_order(req: func.HttpRequest, order: func.DocumentList) -> func.HttpResponse:
    if not order:
        return func.HttpResponse(status_code=404)
    return func.HttpResponse(json.dumps(order[0].to_dict()), mimetype="application/json")


# Service Bus trigger + Service Bus output binding
@app.service_bus_queue_trigger(arg_name="msg", queue_name="ingest",
                               connection="ServiceBusConnection")
@app.service_bus_queue_output(arg_name="out", queue_name="embeddings",
                              connection="ServiceBusConnection")
def chunk_document(msg: func.ServiceBusMessage, out: func.Out[str]) -> None:
    doc = json.loads(msg.get_body().decode())
    out.set(json.dumps({"docId": doc["docId"], "chunks": split(doc)}))
```

(`arg_name` is the Python parameter that receives or sends the data. `connection` is the **name of an app setting** prefix, not a secret.)

HTTP auth levels: `ANONYMOUS`, `FUNCTION` (a function key), `ADMIN` (the master key). Use `ANONYMOUS` only behind another layer such as API Management or built-in authentication.

In the older v1 model each function had a `function.json` with a `bindings` array and a `direction` of `in`, `out` or `inout`.

---

## Connections without secrets

The `connection` value names a setting. For **identity-based connections** you do not store a connection string, you store the endpoint and use the function app's **managed identity**:

```text
ServiceBusConnection__fullyQualifiedNamespace = shop-bus.servicebus.windows.net
CosmosDbConnection__accountEndpoint           = https://shop-cosmos.documents.azure.com:443/
```

Then grant the identity the data roles it needs (for example *Azure Service Bus Data Receiver* or *Data Sender*). That is the answer to "no stored credentials".

---

## Configuration: `host.json`, `local.settings.json`, app settings

| File or place | Scope | Notes |
|---------------|-------|-------|
| `host.json` | Settings for **all functions** in the app: logging, retry, extension options (for example Service Bus concurrency) | Deployed with the code |
| `local.settings.json` | **Local development only**: settings and connection values | **Not deployed**, keep it out of source control |
| **Application settings** in Azure | Environment variables of the running app: connections, feature values | Set with `az functionapp config appsettings set` |

A required setting that exists in `local.settings.json` but not in Azure app settings is the classic "works on my machine" failure.

---

## Hosting plans

| Plan | Scale | Notes |
|------|-------|-------|
| **Flex Consumption** | Event-driven, scales to zero, per-function scaling | Serverless plan with virtual network support and configurable instance memory |
| **Consumption** | Event-driven, scales to zero | The older serverless plan |
| **Premium** | Pre-warmed instances, no cold start, VNET | For latency-sensitive work |
| **Dedicated (App Service plan)** | Fixed capacity | Use existing App Service capacity, **Always On** needed |
| **Container Apps** | KEDA based | Run Functions as a container |

Cold start is the delay of starting a new instance after idle. Premium or a minimum instance count avoids it.

---

## Deploy

```bash
# create the app
az functionapp create --resource-group rg-ai --name shop-func \
  --storage-account shopfuncsa --runtime python --runtime-version 3.12 \
  --flexconsumption-location westeurope

# develop and test locally
func start

# publish the code
func azure functionapp publish shop-func

# settings
az functionapp config appsettings set -g rg-ai -n shop-func \
  --settings "ServiceBusConnection__fullyQualifiedNamespace=shop-bus.servicebus.windows.net"
```

Other deployment paths: zip deploy, GitHub Actions or Azure Pipelines, and **container deployment** for custom images. Deployment slots exist for the plans that support them, and let you test and swap.

---

## Reliability reminders

- Trigger sources have different retry behavior. **Service Bus** redelivers until the max delivery count then dead-letters. **Queue Storage** moves poison messages to a `<name>-poison` queue. A **Timer** has no retry of its own.
- Make functions **idempotent**: a trigger can deliver the same item twice.
- Keep functions **short and stateless**. Long jobs belong in Durable Functions or a Container Apps job.
- **Cosmos DB trigger** needs a **lease container** (it runs the change feed processor for you).

---

## Quick check

1. How many triggers can one function have? **Exactly one.**
2. A function must read from Service Bus without a connection string. **An identity-based connection with `<name>__fullyQualifiedNamespace` and a role assignment for the managed identity.**
3. Which file is never deployed? **`local.settings.json`.**
4. Event-driven scale to zero with virtual network support. **Flex Consumption.**

---

## Official documentation

- [Triggers and bindings in Azure Functions](https://learn.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings)
- [Python developer guide](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-python)
- [Azure Functions](https://learn.microsoft.com/en-us/azure/azure-functions/)
