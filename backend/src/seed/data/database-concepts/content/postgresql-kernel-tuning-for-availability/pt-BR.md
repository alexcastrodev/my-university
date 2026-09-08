---
version: 1.0
updatedAt: 2026-08-05
title: "Kernel Tuning do PostgreSQL para Disponibilidade: Dirty Pages, Swappiness e THP"
summary: Ajustes de sysctl e /sys em nível de sistema operacional que mantêm o PostgreSQL online sob estresse, não apenas mais rápido; vm.dirty_background_bytes/vm.dirty_bytes baseados em bytes para evitar um enorme flush de escrita emergencial, vm.swappiness=1 para manter os backends fora do swap, e desativar Transparent Huge Pages, cuja desfragmentação via khugepaged pode travar o PostgreSQL por dezenas de segundos, uma recomendação que a documentação atual do PostgreSQL agora declara explicitamente.
---
## Objective

O `postgresql.conf` só controla o que acontece dentro do processo do PostgreSQL. Um servidor pode ter um `shared_buffers` e um `checkpoint_completion_target` perfeitamente ajustados e ainda assim travar por dezenas de segundos por causa de decisões que o kernel do Linux toma por baixo dele: quão agressivamente ele adia escrever memória suja em disco, quão disposto está a colocar em swap um backend ocioso, como agenda os processos de trabalho do PostgreSQL em relação a tudo mais na máquina, e se remodela silenciosamente a memória em huge pages pelas costas do PostgreSQL. Essas são configurações de `sysctl` e `/sys`, configuradas uma vez no nível do SO, e são a diferença entre um servidor que degrada graciosamente sob carga e um que fica sem resposta por segundos seguidos sem nada aparecendo como uma consulta lenta.

## Use Cases

- Provisionar um servidor com muita RAM (dezenas ou centenas de GB) e querer evitar um único flush de dirty pages "de emergência" enorme que pode saturar o subsistema de disco e bloquear todas as escritas até terminar.
- Diagnosticar um servidor PostgreSQL de produção que intermitentemente congela por vários segundos a dezenas de segundos sob pressão de memória, sem nenhuma entrada correspondente no `pg_stat_activity` ou no log de consultas lentas: um sintoma clássico de desfragmentação de Transparent Huge Page (THP), e não um problema de banco de dados de fato.
- Blindar um host dedicado ao PostgreSQL contra pressão de memória sem desativar totalmente o swap (`swappiness=0` pode ela mesma introduzir risco de OOM-killer em alguns kernels), mantendo uma margem de segurança fina em vez de um interruptor tudo-ou-nada.
- Ajustar o comportamento do agendador de CPU em um servidor lidando com centenas de conexões de cliente concorrentes, onde as configurações padrão de migração de processo e autogrouping (calibradas para responsividade de desktop, não para throughput de daemon) adicionam overhead de agendamento mensurável.

## Deep Dive

### Onde essas configurações moram

Parâmetros de kernel são definidos com `sysctl`. Em sistemas com um diretório `/etc/sysctl.d`, um arquivo dedicado sobrevive melhor a atualizações de pacote do que editar `/etc/sysctl.conf` diretamente:

```bash
# /etc/sysctl.d/30-postgresql.conf
kernel.sched_migration_cost_ns = 5000000
kernel.sched_autogroup_enabled = 0
vm.dirty_background_bytes = 67108864
vm.dirty_bytes = 1073741824
vm.zone_reclaim_mode = 0
vm.swappiness = 1
```

```bash
# activate immediately, no reboot required
sudo sysctl --system
# or, without a sysctl.d directory, after editing /etc/sysctl.conf directly:
sudo sysctl -p
```

### Agendador de CPU: `sched_migration_cost_ns` e `sched_autogroup_enabled`

- `kernel.sched_migration_cost_ns` (padrão de 0,5 ms) é por quanto tempo o agendador trata o cache de um processo migrado como ainda "quente", tornando-o menos elegível para outra migração. Conforme o número de processos backend do PostgreSQL cresce, o overhead por decisão do agendador pode consumir uma fatia grande da CPU total só atribuindo processadores a tarefas. Elevar isso para 5 ms dá a cada backend tempo suficiente para terminar uma consulta antes de ser considerado para migração de novo.
- `kernel.sched_autogroup_enabled` agrupa tarefas pela sessão de terminal de origem para melhorar a responsividade *interativa*: útil num desktop, ativamente prejudicial num servidor onde o PostgreSQL e tudo mais lançado a partir da mesma sessão de init acabam agrupados em um único grupo de agendamento e efetivamente limitados uns contra os outros. Definir isso como `0` remove esse agrupamento.

### `vm.zone_reclaim_mode`

Em hosts NUMA (multi-socket), um `zone_reclaim_mode` diferente de zero faz o kernel preferir recuperar memória do nó NUMA *local* em vez de usar memória de um nó remoto, incluindo memória usada para fazer cache dos arquivos de dados do PostgreSQL. Essa recuperação local agressiva reduz o tamanho efetivo do page cache do SO. Definir isso como `0` deixa o kernel usar toda a RAM disponível para cache independentemente de a qual socket ela está conectada.

### `vm.dirty_background_bytes` e `vm.dirty_bytes`

```bash
vm.dirty_background_bytes = 67108864     # 64 MB — background flush starts here
vm.dirty_bytes = 1073741824              # 1 GB — hard write-blocking threshold
```

`dirty_background_bytes` é quanta memória modificada (suja) pode se acumular antes de o kernel começar a escrevê-la em disco *em segundo plano*, sem bloquear nada. `dirty_bytes` é o limiar bem maior no qual o kernel para de confiar no background writer e bloqueia **toda** atividade de escrita até que o conjunto sujo inteiro seja descarregado, um evento que, do ponto de vista do PostgreSQL, parece idêntico ao subsistema de disco simplesmente sumir pelo tempo que o flush levar.

Um `dirty_background_bytes` baixo troca uma pequena quantidade de overhead de escrita em regime permanente (flushes pequenos e constantes em vez de poucos grandes e em lote) por tornar aquele limiar de flush de emergência muito menos provável de ser alcançado.

### `vm.swappiness`

```bash
vm.swappiness = 1
```

`swappiness` controla quão avidamente o kernel move memória de processo ociosa para o swap sob pressão de memória. Backends do PostgreSQL segurando estado de consulta não se beneficiam de serem colocados em swap, e pagar o custo de trazê-los de volta quando uma consulta é retomada é exatamente o tipo de travada que um servidor de alta disponibilidade não pode se dar ao luxo. `1` praticamente desativa o swap enquanto deixa uma válvula de último recurso; `0` é evitado porque algumas versões de kernel respondem a isso invocando o OOM killer mais cedo em vez de fazer swap, o que é um resultado pior do que fazer swap ocasionalmente.

### Desativando Transparent Huge Pages

```bash
echo never > /sys/kernel/mm/transparent_hugepage/enabled
echo never > /sys/kernel/mm/transparent_hugepage/defrag
echo no    > /sys/kernel/mm/transparent_hugepage/khugepaged/defrag
# if the khugepaged line above errors, use the numeric form instead:
echo 0     > /sys/kernel/mm/transparent_hugepage/khugepaged/defrag
```

Transparent Huge Pages deixam o kernel apoiar silenciosamente a memória de um processo com páginas grandes (tipicamente 2 MB) em vez das páginas padrão de 4 KB, sem que a aplicação peça por isso; diferente da própria configuração explícita `huge_pages` do PostgreSQL em `postgresql.conf`, que solicita huge pages deliberada e previsivelmente. O problema do THP é o *khugepaged*, a thread de kernel em segundo plano que periodicamente varre a memória e a desfragmenta em blocos contíguos do tamanho de huge pages. Em um servidor movimentado com `shared_buffers` ocupando uma região de memória grande e ativamente usada, essa passada de desfragmentação pode travar os processos que tocam aquela memória por dezenas de segundos, indistinguível, de fora, de o PostgreSQL simplesmente ter travado.

### Persistindo a configuração de THP entre reboots

O THP é uma configuração de runtime em `/sys`, não um valor de `sysctl`, então ele reseta a cada reboot a menos que seja reaplicado no momento de boot. O mecanismo é específico de cada distribuição e bootloader:

```bash
# RHEL / CentOS and derivatives — bakes the kernel command-line argument
# into every installed kernel entry
sudo grubby --update-kernel=ALL --args='transparent_hugepage=never'
```

```bash
# Debian / Ubuntu — edit /etc/default/grub
GRUB_CMDLINE_LINUX="transparent_hugepage=never"
```
```bash
sudo update-grub
```

Uma alternativa independente de distribuição, que evita mexer no bootloader por completo, é uma pequena unit `systemd` do tipo oneshot que roda cedo no boot e escreve diretamente nos três caminhos `/sys` acima (ou, em sistemas da família RHEL, `tuned-adm profile` combinado com um perfil `tuned` customizado que define `transparent_hugepage=never`); vale preferir isso em deployments containerizados ou baseados em imagem, onde editar configuração do GRUB não é prático.

## Trade-offs

- **Um `dirty_background_bytes` baixo reduz ligeiramente o throughput de escrita em regime permanente em troca de evitar uma travada de bloqueio de escrita de vários segundos.** Flushes pequenos e frequentes em segundo plano custam mais overhead total de I/O do que poucos, maiores e em lote: uma troca deliberada de desempenho médio por um pior caso limitado.
  ```bash
  # inspect current dirty memory accounting live
  grep -E '^Dirty|^Writeback' /proc/meminfo
  ```
- **`swappiness=1` em vez de `0` aceita um pequeno risco de swap para evitar um pior.** Alguns kernels respondem a `0` preferindo o OOM killer em vez de fazer swap sob pressão: matar um backend de vez é um modo de falha pior do que a latência breve de trazê-lo de volta do swap.
  ```bash
  sysctl vm.swappiness
  ```
- **Desativar o THP em todo o sistema abre mão de uma otimização de gerenciamento de memória para todo outro processo no host, não só o PostgreSQL**, em troca de remover a exposição do PostgreSQL a travadas de `khugepaged`: uma troca razoável em um host dedicado a banco de dados, menos obviamente vantajosa em um host que o PostgreSQL compartilha com outras cargas de trabalho de memória grande que poderiam de fato se beneficiar do THP.
  ```bash
  cat /sys/kernel/mm/transparent_hugepage/enabled
  # [never] madvise always   <- bracketed value is the active mode
  ```
- **`kernel.sched_autogroup_enabled=0` troca a equidade interativa estilo desktop por throughput de daemon**: a configuração existe especificamente para fazer tarefas em primeiro plano/interativas parecerem mais responsivas isolando-as da carga de fundo, um objetivo que é ativamente contraproducente em um servidor onde o PostgreSQL *é* a carga de trabalho, não uma tarefa de fundo competindo com algo mais importante.
- **`vm.zone_reclaim_mode=0` é um no-op em hardware de nó único.** Só importa em hosts NUMA multi-socket; definir isso não tem efeito, positivo ou negativo, em um servidor de nó único, então vale a pena confirmar a topologia NUMA antes de assumir que a configuração está fazendo alguma coisa.
  ```bash
  numactl --hardware | head -1
  # e.g. "available: 2 nodes (0-1)" confirms this setting is actually relevant
  ```

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020), Chapter 3, "Minimizing Downtime", recipe "Applying bonus kernel tweaks", p. 132-136] - doc
- [PostgreSQL Documentation: Resource Consumption (huge_pages parameter, THP discouraged)](https://www.postgresql.org/docs/current/runtime-config-resource.html) - doc
- [PostgreSQL Documentation: Managing Kernel Resources](https://www.postgresql.org/docs/current/kernel-resources.html) - doc
- [Linux Kernel Documentation: Transparent Hugepage Support](https://www.kernel.org/doc/html/latest/admin-guide/mm/transhuge.html) - doc
- [Red Hat Enterprise Linux 9 Documentation: Configuring Transparent Huge Pages](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/monitoring_and_managing_system_status_and_performance/configuring-huge-pages_monitoring-and-managing-system-status-and-performance) - doc
