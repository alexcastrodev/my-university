---
version: 1.0
updatedAt: 2026-08-17
title: "Escolhendo um Servidor de Aplicação: Puma, Unicorn e Passenger"
summary: Todo servidor de aplicação Ruby escolhe um trade-off entre se defender de um cliente lento e se defender de uma aplicação lenta; saber qual é qual decide a topologia do seu deploy.
---
## Objective

Todo servidor de aplicação Ruby faz um trade-off ao longo de um eixo: ele
protege a aplicação de um **cliente lento** (uma requisição cujos bytes
chegam aos poucos), protege contra uma **aplicação lenta** (uma requisição
cujo próprio código demora muito), ou os dois? Webrick e Thin cobrem só um
lado cada; Unicorn cobre "aplicação lenta" mas precisa de um proxy reverso
com buffer na frente para cobrir "cliente lento"; Puma (em cluster) e
Phusion Passenger são os únicos dois que lidam com os dois sozinhos, o que
é o motivo de serem a escolha padrão para a maioria dos deploys Rails de
produção hoje.

## Use Cases

- Escolher entre Puma e Unicorn para um novo deploy, e saber *por que* o
  Unicorn exige o NGINX (ou um proxy com buffer equivalente) na frente dele
  em produção, nunca exposto diretamente.
- Dimensionar o número de processos worker e threads por processo para uma
  dada quantidade de RAM e CPU disponíveis.
- Diagnosticar "tempo de fila" em um APM: reconhecer que uma fila crescente
  significa que a aplicação precisa de mais capacidade (ou a frota está
  subdimensionada), não que uma requisição individual precisa ser mais
  rápida.
- Decidir se um pico de tempo de resposta é causado pela própria aplicação
  ou por requisições fazendo fila esperando por um worker livre.

## Deep Dive

### As duas ameaças: cliente lento, aplicação lenta

Um "cliente lento" é uma requisição que demora muito para *enviar*: um
usuário mobile em uma conexão ruim enviando um formulário grande, ou pior,
um cliente deliberadamente mantendo uma conexão aberta (um vetor básico de
negação de serviço). Uma "aplicação lenta" é uma requisição que chega
instantaneamente mas leva muito tempo para o servidor *processar*: uma
query cara, um N+1, uma chamada lenta a uma API de terceiros.

```
Webrick     - processo único, bloqueia completamente com qualquer ameaça. Nunca use em produção.
Thin        - processo único, orientado a eventos (EventMachine). Protege contra clientes
              lentos; NÃO protege contra uma aplicação lenta sem usar o reactor manualmente.
Unicorn     - multiprocesso, workers escutam diretamente em um socket compartilhado. Protege
              contra uma aplicação lenta (outros workers livres continuam aceitando requisições)
              mas um cliente lento pode travar um worker enquanto envia bytes aos poucos, PRECISA
              rodar atrás de um proxy reverso com buffer (NGINX) que o protege dos clientes.
Puma        - threaded, reactor orientado a eventos. O reactor protege contra clientes lentos;
  (em cluster) o modo cluster (vários processos worker, cada um multithreaded) adiciona
              proteção contra uma aplicação lenta da mesma forma que o Unicorn.
Passenger 5 - combina um proxy com buffer e múltiplos processos internamente, então lida
              com as duas ameaças sem precisar de mais nada na frente.
```

### Por que o Unicorn precisa do NGINX na frente

```
Client (slow upload) ---> Unicorn worker
```

Sem um proxy com buffer, um worker do Unicorn fica ocupado durante todo o
tempo que o cliente leva para terminar de enviar a requisição, mesmo que o
código da aplicação ainda não tenha começado a rodar. Com o NGINX (ou
equivalente) na frente:

```
Client (slow upload) ---> NGINX (buffers the full request) ---> Unicorn worker
```

O NGINX absorve o custo do upload lento ele mesmo e só entrega ao worker
uma requisição totalmente bufferizada, então o worker fica ocupado só pelo
tempo que leva para de fato rodar o código da aplicação, que é a única
ameaça (aplicação *lenta*) para a qual o modelo multiprocesso do Unicorn foi
construído para isolar.

### Dimensionando processos e threads

```
processes ≈ available_RAM / (RAM_per_process × 1.2)
          cross-checked against ~1.25-1.5 × available hyperthreads
```

Meça `RAM_per_process` só depois de o processo ter rodado 12 a 24h sem um
reinício; um processo Ruby recém-iniciado é tipicamente de 2 a 3 vezes
menor que sua pegada de memória em estado estável, então dimensionar a
partir de um boot frio subestima o uso real. No MRI, threads param de
compensar depois de aproximadamente 5 threads por processo para cargas de
trabalho web típicas, porque a GVL significa que só uma thread executa
bytecode Ruby por vez (veja o conceito de GVL e Concorrência); mais threads
ajudam a concorrência para tratamento de requisição ligado a I/O, mas não
indefinidamente.

## Trade-offs

- **Unicorn "nu" (sem proxy reverso na frente) é uma configuração incorreta
  de produção real, não uma omissão pequena**: deixa todo worker vulnerável
  a ser travado por um único cliente lento, efetivamente limitando a
  concorrência do servidor a qualquer fração de workers que um punhado de
  clientes lentos consiga prender.
- **Mais processos trocam memória por isolamento e proteção contra
  aplicação lenta; mais threads não trocam nada por concorrência de I/O,
  mas batem em um teto rígido da GVL em trabalho ligado a CPU**: a mistura
  certa depende de se a requisição típica da aplicação é ligada a I/O
  (favoreça threads) ou tem segmentos reais ligados a CPU (favoreça
  processos).
- **Escalar o número de instâncias de servidor só ajuda quando o tempo de
  fila já está de fato elevado** (regra prática: acima de 5 a 10ms em
  relação ao tempo médio de resposta); escalar antes disso gasta dinheiro
  sem tornar nenhuma requisição individual mais rápida, já que o gargalo
  ainda não é capacidade.

## Documentation Links

- [Puma, GitHub (README, modelo de concorrência)](https://github.com/puma/puma) (doc)
- [The Complete Guide to Rails Performance, Webservers and I/O models](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) (doc)
