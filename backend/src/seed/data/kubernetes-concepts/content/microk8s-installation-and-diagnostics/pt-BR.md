---
version: 1.0
updatedAt: 2026-09-26
title: "Instalação e Diagnóstico do MicroK8s"
summary: "Instalar o MicroK8s a partir de um canal de snap fixado, o que roda dentro do snap, esperar o cluster ficar pronto, kubectl sem sudo e gerar um relatório de diagnóstico."
---
## Objective

O MicroK8s é o Kubernetes em pacote único da Canonical: um snap que contém o API server, o scheduler, o controller manager, o kubelet, o kube-proxy, o containerd, um CNI (Calico) e um datastore. É uma escolha comum para um servidor de produção de nó único, um site de borda ou uma máquina de laboratório, porque instala com um comando e atualiza por canais de snap. Este conceito cobre a instalação com um canal de versão fixado, a verificação de que o cluster está realmente pronto, rodar `kubectl` sem `sudo` e coletar um relatório de diagnóstico quando algo dá errado.

## Use Cases

- Subir um Kubernetes de um nó numa VM Ubuntu ou num servidor bare-metal para uma produção pequena.
- Fixar o cluster numa versão minor do Kubernetes para que um refresh automático do snap nunca pule para a próxima.
- Escrever um script de bootstrap que espera o cluster antes de aplicar manifests.
- Anexar um pacote de suporte (`microk8s inspect`) a uma issue ou entregá-lo a um colega.

## Deep Dive

### Instalando com um canal de versão

```bash
sudo snap install microk8s --classic --channel=1.35/stable
```

- `--classic` é obrigatório: o MicroK8s precisa de acesso ao host (rede, montagens, cgroups) que um snap estritamente confinado não tem.
- O canal é `<k8s-minor>/<risco>`. `1.35/stable` significa "a última 1.35.x estável". O snap atualiza sozinho, mas **só dentro do canal acompanhado**: você recebe patches de 1.35.5 para 1.35.6, nunca 1.36.
- Sem `--channel` você recebe o track padrão do snap, que a Canonical muda com o tempo. Verificado em setembro de 2026: um `snap install microk8s --classic` simples instalou `v1.35.6` acompanhando `1.35/stable`, enquanto `latest/stable` já estava em `v1.36.2`. O mesmo script, portanto, instala versões minor diferentes dependendo do dia em que roda. Para qualquer coisa que importe, fixe sempre.

Ir para a próxima minor é uma ação explícita:

```bash
sudo snap refresh microk8s --channel=1.36/stable
```

Veja o que você acompanha e o que existe:

```bash
snap list microk8s          # versão instalada, revisão, canal acompanhado
snap info microk8s          # todos os canais e suas versões
```

Verificado numa VM Ubuntu 24.04 nova (setembro de 2026): `1.35/stable` instalou `v1.35.6`, acompanhando `1.35/stable`. Nessa data a `1.36` já tinha sido lançada pelo MicroK8s, mas ainda estava sendo promovida pelos canais, que é exatamente o motivo para fixar.

Refreshes do snap também reiniciam os serviços do MicroK8s. Verificado com `snap restart microk8s`: os containers em execução continuaram rodando (restart count 0), mas o API server fica indisponível por um tempo, então deploys e agendamento ficam parados até ele voltar. Você pode controlar a janela:

```bash
sudo snap set system refresh.timer=sat,03:00-04:00   # janela de refresh
sudo snap refresh --hold=720h microk8s               # adia os refreshes deste snap
```

### O que roda dentro do snap

O MicroK8s não roda o control plane como Pods separados, como o kubeadm faz. Os componentes do Kubernetes rodam num único processo, o `kubelite`, gerenciado pelo systemd:

```
snap.microk8s.daemon-containerd
snap.microk8s.daemon-kubelite        # apiserver + scheduler + controller-manager + kubelet + proxy
snap.microk8s.daemon-k8s-dqlite      # o datastore (dqlite, não etcd)
snap.microk8s.daemon-apiserver-kicker
snap.microk8s.daemon-cluster-agent
```

Duas consequências: `kubectl get pods -n kube-system` mostra só add-ons (Calico, CoreDNS, ...), nunca um Pod `kube-apiserver`; e o datastore é dqlite, então ferramentas específicas de etcd (`etcdctl snapshot`) não se aplicam.

### Está pronto?

```bash
microk8s status --wait-ready
```

`--wait-ready` bloqueia até o API server responder, o que faz dele a primeira linha certa de qualquer script de bootstrap. A saída também lista quais add-ons estão habilitados. Numa instalação nova da 1.35, `dns` já vem habilitado; `hostpath-storage`, `ingress`, `rbac` e `metrics-server` não.

Depois verifique o próprio nó:

```bash
microk8s kubectl get nodes -o wide
microk8s kubectl get pods -A
```

Um nó `Ready` com `calico-node`, `calico-kube-controllers` e `coredns` rodando é um cluster funcionando.

### Rodando kubectl sem sudo

Na instalação padrão, todo comando precisa de `sudo`. Rodar `microk8s status` como usuário comum imprime a correção:

```
Insufficient permissions to access MicroK8s.
You can either try again with sudo or add the user ubuntu to the 'microk8s' group:

    sudo usermod -a -G microk8s ubuntu
    sudo chown -R ubuntu ~/.kube
```

```bash
sudo usermod -a -G microk8s $USER
mkdir -p ~/.kube && sudo chown -R $USER ~/.kube
newgrp microk8s        # ou saia e entre de novo na sessão
```

Pertencer ao grupo `microk8s` é, na prática, ser cluster-admin: o grupo consegue ler as credenciais de admin em `/var/snap/microk8s/current/credentials`. Trate-o como o grupo `docker`.

`microk8s kubectl` é um kubectl embutido na mesma versão do cluster. Duas formas de digitar menos:

```bash
sudo snap alias microk8s.kubectl kubectl     # alias para o sistema todo
alias kubectl='microk8s kubectl'             # alias só do shell
```

O alias do snap conflita com um `kubectl` instalado separadamente. Se você usa um kubectl independente (para falar com vários clusters), exporte o kubeconfig em vez disso; veja o conceito de kubeconfig.

### Coletando diagnóstico

```bash
sudo microk8s inspect
```

Ele verifica cada serviço (`Service snap.microk8s.daemon-kubelite is running`) e copia para um tarball os args de cada componente, a lista de processos, uso de disco e memória, configuração de rede, limites de inotify e um dump do dqlite:

```
Building the report tarball
  Report tarball is at /var/snap/microk8s/<revision>/inspection-report-<date>.tar.gz
```

Ele também imprime avisos para problemas comuns do host, como firewall bloqueando o tráfego dos Pods ou IP forwarding desabilitado. Para um único serviço com falha, o journal do systemd é mais rápido:

```bash
sudo journalctl -u snap.microk8s.daemon-kubelite --since "10 min ago"
```

## Trade-offs

- **Patches automáticos vs controle.** Ficar dentro de um canal traz patches de segurança de graça, ao custo de um restart não planejado. Num servidor de produção de nó único, defina uma janela de refresh ou segure os refreshes e aplique patches deliberadamente.
- **`microk8s kubectl` embutido vs kubectl independente.** O embutido sempre bate com a versão do servidor e não precisa de configuração. Um kubectl independente é necessário assim que você gerencia mais de um cluster ou roda comandos do seu laptop ou do CI.
- **O grupo `microk8s` é conveniente e poderoso.** Adicionar um usuário a ele é conceder acesso total ao cluster, não "permissão para rodar kubectl".
- **Pacote único, domínio de falha único.** Um restart do processo `kubelite` reinicia o control plane inteiro e o kubelet. Tudo bem para um nó; para disponibilidade real você precisa de três nós (`microk8s add-node`) e do add-on `ha-cluster`.

## Documentation Links

- [MicroK8s: Getting started](https://canonical.com/microk8s/docs/getting-started): instalação, grupo, primeiros comandos.
- [MicroK8s: Selecting a snap channel](https://canonical.com/microk8s/docs/setting-snap-channel): nomes de canais e como fixar.
- [MicroK8s: Upgrading a cluster](https://canonical.com/microk8s/docs/upgrade-cluster): mudar de versão minor.
- [MicroK8s: Release notes](https://canonical.com/microk8s/docs/release-notes): o que mudou em cada versão (por exemplo, o add-on de ingress trocando NGINX por Traefik).
- [Snapcraft: Managing updates](https://snapcraft.io/docs/managing-updates): timers de refresh e holds.
