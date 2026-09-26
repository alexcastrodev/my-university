---
version: 1.0
updatedAt: 2026-09-26
title: "Probes de Startup, Liveness e Readiness"
summary: "O que cada probe dispara, como os campos de tempo se combinam, e as regras que impedem as probes de transformar uma dependência lenta numa queda geral."
---
## Objective

O kubelet consegue verificar um container de três jeitos, e cada resposta dispara uma ação diferente. Uma probe de **readiness** que falha tira o Pod dos endpoints do Service, mas o deixa rodando. Uma probe de **liveness** que falha reinicia o container. Uma probe de **startup** segura as outras duas até a aplicação terminar de subir. Confundi-las é uma das formas mais comuns de transformar uma dependência lenta numa queda do cluster inteiro. Este conceito cobre o que cada probe faz, como os campos de tempo se combinam, e as regras que impedem as probes de causar as falhas que deveriam detectar.

## Use Cases

- Um serviço que precisa de 40 segundos para subir e é morto aos 30 por uma liveness probe apressada.
- Tirar um Pod do balanceamento enquanto ele aquece ou perde uma dependência, sem reiniciá-lo.
- Recuperar automaticamente um processo em deadlock que ainda tem a porta aberta.
- Fazer rolling updates pararem quando a versão nova está quebrada.

## Deep Dive

### O que cada probe faz

| Probe | Pergunta | Em caso de falha |
|---|---|---|
| `startupProbe` | A aplicação terminou de subir? | Continua verificando até `failureThreshold`; depois o container é morto e reiniciado |
| `livenessProbe` | O processo está saudável ou travado sem volta? | O container é reiniciado (`RESTARTS` aumenta) |
| `readinessProbe` | Consegue atender tráfego agora? | Pod marcado `NotReady`, removido dos endpoints do Service; sem restart |

Enquanto uma probe de startup está definida e ainda não teve sucesso, as de liveness e readiness não rodam. Depois que ela tem sucesso, nunca mais roda para aquele container.

A readiness também conduz os rollouts: um Pod novo só conta como disponível quando está Ready, então uma versão que nunca fica pronta trava o RollingUpdate em vez de substituir Pods saudáveis.

### Mecanismos de probe

```yaml
httpGet:   {path: /healthz, port: 8080}          # status 200-399 é sucesso
tcpSocket: {port: 6379}                          # a conexão abre
exec:      {command: ["redis-cli", "ping"]}      # exit code 0
grpc:      {port: 9090}                          # protocolo de health check do gRPC
```

`httpGet` é a escolha padrão para aplicações web. `exec` cria um processo dentro do container a cada período, o que pesa em nós ocupados; prefira HTTP ou TCP quando possível.

### Campos de tempo

```yaml
containers:
  - name: app
    image: registry.example.com/demo/web-app:1.4.2
    ports: [{name: http, containerPort: 8080}]
    startupProbe:
      httpGet: {path: /healthz, port: http}
      periodSeconds: 5
      failureThreshold: 36        # até 36 x 5s = 180s para subir
    livenessProbe:
      httpGet: {path: /healthz, port: http}
      periodSeconds: 10
      timeoutSeconds: 2
      failureThreshold: 3         # 3 falhas seguidas, cerca de 30s, antes de um restart
    readinessProbe:
      httpGet: {path: /readyz, port: http}
      periodSeconds: 5
      failureThreshold: 2
      successThreshold: 1
```

- `initialDelaySeconds`: espera antes da primeira verificação. Com uma probe de startup você raramente precisa dele.
- `periodSeconds` (padrão 10), `timeoutSeconds` (padrão 1), `failureThreshold` (padrão 3), `successThreshold` (padrão 1, tem que ser 1 para liveness e startup).
- O pior tempo de reação é mais ou menos `periodSeconds x failureThreshold`.
- `port` pode ser uma porta nomeada do container, como acima, para a probe acompanhar a porta se ela mudar.

O orçamento de startup é `periodSeconds x failureThreshold`. Dimensione para a subida realista mais lenta (caches frios, CPU limitada por um limit baixo, uma primeira conexão lenta a uma dependência), não para a média.

### Dois endpoints, dois significados

Uma convenção comum, usada inclusive pelo próprio API server do Kubernetes (`/livez`, `/readyz`):

- `/healthz` (ou `/livez`): "o processo funciona". Responde da memória, não verifica nada externo.
- `/readyz`: "consigo atender requisições agora". Pode verificar se o aquecimento terminou e se recursos locais críticos (um pool de conexões, um modelo carregado, um cache) estão disponíveis.

Muitos frameworks já trazem os dois endpoints prontos; seja qual for o seu, garanta que o endpoint de liveness não inclua verificações externas.

### As regras que evitam quedas

**1. A liveness não pode depender de nada fora do processo.** Se o endpoint de liveness verifica um banco compartilhado, uma oscilação no banco faz todas as réplicas falharem na liveness ao mesmo tempo, e o Kubernetes reinicia todas juntas. Os restarts não consertam o banco; eles adicionam uma avalanche de reconexões e cold starts. A liveness responde só "este processo está quebrado sem autorrecuperação" (deadlock, estado interno corrompido).

**2. A readiness pode depender de dependências críticas, com cuidado.** Tirar um Pod de rotação quando ele não alcança a sua dependência é razoável. Mas se todas as réplicas compartilham a mesma dependência, todas ficam NotReady juntas e o Service fica sem endpoints: quem chama recebe connection refused em vez de um erro claro da sua aplicação. Decida por dependência se "não pronto" ou "pronto mas degradado" é a falha melhor.

**3. Nunca use as mesmas configurações agressivas para startup e liveness.** Antes das probes de startup, as pessoas usavam um `initialDelaySeconds` grande na liveness, o que também atrasa a detecção de travamentos reais. Uma probe de startup com orçamento generoso mais uma liveness apertada dão detecção rápida e tolerância a subida lenta.

**4. Os timeouts precisam sobreviver a pausas e a throttling de CPU.** `timeoutSeconds: 1` com um limit de CPU de 250m num serviço ocupado falha de forma intermitente sob carga. Um restart por liveness então piora o problema de carga.

**5. Probes precisam de um endpoint barato.** A probe roda a cada poucos segundos em cada réplica. Ela não deveria rodar queries, chamar outros serviços nem alocar muita memória.

### Vendo falhas de probe

```bash
kubectl describe pod web-xyz
#  Warning  Unhealthy  kubelet  Readiness probe failed: HTTP probe failed with statuscode: 503
#  Warning  Unhealthy  kubelet  Liveness probe failed: Get "http://10.1.2.3:8080/healthz": context deadline exceeded
#  Normal   Killing    kubelet  Container app failed liveness probe, will be restarted
kubectl get pods         # READY 0/1 = readiness falhando; RESTARTS subindo = liveness ou crashes
```

`Killing ... failed liveness probe` nos eventos distingue um restart causado pela probe de um crash. Um container morto pela liveness mostra exit code 137 (SIGKILL depois do grace period) ou 143 (SIGTERM atendido).

## Trade-offs

- **Liveness probe vs nenhuma.** Uma liveness probe recupera deadlocks automaticamente; uma mal ajustada causa restarts que nunca seriam necessários. Se você não consegue definir uma verificação significativa de "quebrado sem volta", não ter liveness probe costuma ser mais seguro do que ter uma ingênua.
- **Readiness incluindo dependências vs não.** Incluí-las protege quem chama de uma réplica que não consegue trabalhar; excluí-las evita que todas as réplicas sumam do Service juntas.
- **Períodos curtos vs longos.** Detecção mais rápida custa mais tráfego de probe e mais falsos positivos sob carga.

## Documentation Links

- [Kubernetes docs: Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/): conceitos e interações.
- [Kubernetes docs: Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/): todos os campos e padrões.
- [Kubernetes docs: Pod Lifecycle (container probes)](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes): resultados das probes e restarts.
- [Kubernetes docs: Kubernetes API health endpoints](https://kubernetes.io/docs/reference/using-api/health-checks/): a convenção `/livez` e `/readyz`.
