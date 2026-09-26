---
version: 1.0
updatedAt: 2026-09-26
title: "metrics-server e kubectl top"
summary: "Habilitar o metrics-server, o que os números do kubectl top significam, comparar uso com requests e limits, e dimensionar a partir do histórico do Prometheus."
---
## Objective

O `kubectl top` mostra o uso atual de CPU e memória de nós e Pods. Os dados não vêm do próprio API server, e sim do **metrics-server**, um add-on pequeno que coleta dos kubelets a cada poucos segundos e serve os últimos valores pela Metrics API. É o jeito mais rápido de ver quem está usando o quê agora, e também é o que o Horizontal Pod Autoscaler lê. Ele não guarda histórico, e é por isso que decisões de dimensionamento também precisam do Prometheus. Este conceito cobre habilitar o metrics-server, ler o `kubectl top` corretamente, e transformar medições em requests e limits.

## Use Cases

- Encontrar o Pod que está devorando a memória do nó.
- Conferir o uso real de um container contra os seus requests e limits.
- Fornecer métricas ao Horizontal Pod Autoscaler.
- Começar um exercício de ajuste de tamanho num namespace.

## Deep Dive

### Habilitando

```bash
microk8s enable metrics-server      # MicroK8s
kubectl get apiservice v1beta1.metrics.k8s.io      # AVAILABLE precisa ser True
```

O k3s já traz por padrão. Sem ele, o `kubectl top` falha com `error: Metrics API not available`. Se o APIService mostra `False`, o metrics-server não consegue alcançar os kubelets (muitas vezes um problema de TLS em clusters montados à mão, resolvido com `--kubelet-insecure-tls` em laboratório ou com certificados de serving corretos no kubelet em produção). Uma API agregada quebrada também bloqueia a remoção de namespaces, então conserte ou remova em vez de deixar instalado pela metade.

### Lendo o kubectl top

Verificado no MicroK8s 1.35 logo depois de habilitar ingress e metrics-server:

```
$ kubectl top node
NAME          CPU(cores)   CPU(%)   MEMORY(bytes)   MEMORY(%)
claude-mk8s   70m          3%       1411Mi          37%

$ kubectl top pods -A
NAMESPACE     NAME                                       CPU(cores)   MEMORY(bytes)
ingress       traefik-vkpfl                              1m           19Mi
kube-system   calico-node-plbml                          9m           99Mi
kube-system   coredns-78894c95f4-8p5nf                   1m           11Mi
kube-system   metrics-server-6577ff95c4-gkfpc            1m           15Mi
```

Variantes úteis:

```bash
kubectl top pods -n team-a --containers          # por container, não por Pod
kubectl top pods -A --sort-by=memory | head      # maiores consumidores
kubectl top pods -l app=web --sum                # total de um selector
```

O que os números são:

- **CPU**: média da última janela de coleta, em millicores (`70m` = 7% de um core). Picos curtos são suavizados.
- **Memória**: o **working set** do container (memória residente menos o cache de arquivos inativo). É o número que o kubelet usa para decidir evictions e, aproximadamente, o que conta para o limit de OOM, então é o certo para comparar com os limits.
- **% de memória do nó** é relativa ao **allocatable**, não à RAM total, e inclui tudo que roda no nó (o SO, os componentes do Kubernetes), não só os Pods. A soma do `top pods` é portanto menor que o `top node`.

### Comparando uso com requests e limits

O `kubectl top` mostra só o uso. Coloque-o ao lado do spec:

```bash
kubectl -n team-a get pods -o custom-columns=\
NAME:.metadata.name,\
REQ_MEM:.spec.containers[0].resources.requests.memory,\
LIM_MEM:.spec.containers[0].resources.limits.memory,\
REQ_CPU:.spec.containers[0].resources.requests.cpu
kubectl -n team-a top pods
```

Sinais a procurar:

- Uso perto do limit de memória: um `OOMKilled` esperando para acontecer.
- Uso muito abaixo do request: o nó reserva capacidade que ninguém usa, o que depois aparece como Pods `Pending` em outro lugar.
- Uso de CPU no limit de CPU: throttling, visível como latência.

### De uma fotografia a uma decisão de dimensionamento

O metrics-server guarda só o último valor. Dimensionar exige histórico, sob carga real, ao longo de dias. Com o Prometheus (veja os conceitos de observabilidade):

```
# pico de working set de memória por container em 7 dias
max_over_time(container_memory_working_set_bytes{namespace="team-a", container!=""}[7d])

# p95 de uso de CPU por container em 7 dias
quantile_over_time(0.95, rate(container_cpu_usage_seconds_total{namespace="team-a", container!=""}[5m])[7d:5m])
```

Uma regra prática:

- **Request de memória = limit = pico de working set + 20 a 30%.** Memória não é compressível; o que importa é o pico, não a média.
- **Request de CPU ≈ p95 do uso**, limit de CPU ausente ou generoso (veja o conceito de resources para o porquê).
- Meça de novo depois de mudanças grandes de versão da aplicação ou do seu runtime, e depois de mudanças de tráfego.

Ferramentas como o Vertical Pod Autoscaler em modo de recomendação (`updateMode: "Off"`) automatizam exatamente essa análise e sugerem valores sem mudar nada.

### O Horizontal Pod Autoscaler usa os mesmos dados

```bash
kubectl -n team-a autoscale deploy/web --cpu-percent=70 --min=2 --max=6
kubectl -n team-a get hpa
```

As porcentagens do HPA são relativas aos **requests**. Um Deployment sem requests de CPU não pode ser autoescalado por CPU (alvos `<unknown>`). Requests errados produzem escalonamento errado.

## Trade-offs

- **metrics-server vs Prometheus.** O metrics-server é pequeno e dá valores atuais mais autoescalonamento; o Prometheus guarda histórico e permite análise de verdade, a um custo de recursos muito maior. A maioria dos clusters precisa dos dois.
- **Dimensionar por picos vs médias.** Picos protegem contra OOM kills e desperdiçam um pouco de capacidade; médias empacotam mais workloads e falham sob carga.
- **Ajuste manual vs VPA.** A revisão manual é transparente e periódica; as recomendações do VPA são contínuas e precisam de um componente próprio.

## Documentation Links

- [Kubernetes docs: Resource metrics pipeline](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/): metrics-server e a Metrics API.
- [metrics-server on GitHub](https://github.com/kubernetes-sigs/metrics-server): instalação e flags.
- [kubectl top reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_top/): subcomandos de node e pod.
- [Kubernetes docs: Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/): como o HPA usa métricas de recursos.
- [MicroK8s: Add-ons](https://canonical.com/microk8s/docs/addons): o add-on metrics-server.
