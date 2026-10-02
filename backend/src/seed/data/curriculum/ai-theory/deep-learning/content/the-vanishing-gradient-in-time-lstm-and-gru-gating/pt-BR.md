---
version: 1.0
updatedAt: 2026-09-07
title: "O Gradiente que Desaparece no Tempo: Gating de LSTM e GRU"
summary: O mesmo problema do gradiente que desaparece já diagnosticado para redes feedforward muito profundas reaparece de forma ainda mais aguda quando uma rede recorrente é desdobrada ao longo de uma sequência longa. E o mecanismo de gating que o corrige: as portas de esquecimento, entrada e saída da LSTM (com a GRU como variante simplificada) mantêm uma célula de memória com um caminho de propagação de erro quase constante ao longo do tempo, permitindo que os gradientes sobrevivam a dezenas ou centenas de passos de tempo em vez de desaparecerem.
---
## Objetivos de Aprendizagem

- Explicar com precisão por que o gradiente de uma RNN simples encolhe (ou explode) exponencialmente com o número de passos de tempo que separam dois pontos de uma sequência.
- Enunciar a célula de memória da LSTM e suas três portas (esquecimento, entrada, saída) e explicar o que cada porta controla.
- Explicar por que a atualização da célula de memória da LSTM cria um caminho de gradiente quase ininterrupto ao longo do tempo, tratando diretamente o problema do gradiente que desaparece.
- Comparar LSTM e GRU no nível do que cada uma simplifica, sem afirmar que uma domina estritamente a outra.

## Contexto e Motivação

O conceito anterior terminou nomeando o mecanismo exato responsável: como a mesma matriz de pesos `W_hh` é reaproveitada a cada passo de tempo, o gradiente que chega a um passo inicial foi, na prática, multiplicado por `W_hh` (e pela derivada local da função de ativação) uma vez por passo de tempo de distância; exatamente o mesmo argumento de composição exponencial já feito para redes feedforward profundas em `weight-initialization-and-the-vanishing-exploding-gradient-problem`, mas aqui movido pelo *comprimento da sequência* em vez do número de camadas. Para sequências longas (dezenas ou centenas de passos de tempo, justamente o regime que as RNNs foram introduzidas para tratar), isso torna uma RNN simples incapaz de aprender dependências que se estendem além de uma janela curta, qualquer que seja a inicialização. A LSTM (long short-term memory) e sua parente simplificada GRU (gated recurrent unit) foram projetadas especificamente para corrigir isso, e fazem isso com um mecanismo genuinamente diferente de inicialização ou normalização: uma célula de memória com portas.

## Teoria Central

### Por que o gradiente da RNN simples desaparece ao longo do tempo

O backpropagation through time calcula o gradiente do loss em algum passo de tempo tardio `T` em relação a um estado oculto inicial `h_t` aplicando repetidamente a regra da cadeia de trás para frente por cada passo de tempo intermediário, e cada um contribui com um fator envolvendo `W_hh` e a derivada da função de ativação. Ao longo de `T − t` passos de tempo, isso produz um produto de `T − t` desses fatores; exatamente a mesma composição exponencial no estilo `c^L` já quantificada para redes feedforward profundas, com a distância na sequência agora fazendo o papel que a profundidade fazia antes. Uma dependência que se estende 50 passos de tempo para trás exige fazer backpropagation por 50 multiplicações repetidas essencialmente pelo mesmo fator; se esse fator estiver um pouco abaixo de 1, o gradiente que chega ao passo 1 vindo de um loss no passo 50 é minúsculo, e a rede, na prática, não consegue aprender que um token de 50 passos atrás importava.

### A célula de memória da LSTM e suas três portas

Uma LSTM introduz uma **célula de memória** separada `C_t`, ao lado do estado oculto, e controla como ela é atualizada usando três **portas** (gates) aprendidas; cada uma é uma pequena camada de rede neural (normalmente uma sigmoid) que produz valores entre 0 e 1 que funcionam como chaves contínuas de "quanto":

```text
Porta de esquecimento: F_t = σ(W_f·[h_{t-1}, x_t] + b_f)      quanto do estado antigo da célula manter
Porta de entrada:      I_t = σ(W_i·[h_{t-1}, x_t] + b_i)      quanta informação nova acrescentar
Porta de saída:        O_t = σ(W_o·[h_{t-1}, x_t] + b_o)      quanto da célula expor como estado oculto

Candidato:             C̃_t = tanh(W_c·[h_{t-1}, x_t] + b_c)   a informação nova sendo proposta
Atualização da célula: C_t = F_t ⊙ C_{t-1} + I_t ⊙ C̃_t         combina a memória antiga e a informação nova
Estado oculto:         h_t = O_t ⊙ tanh(C_t)
```

(`⊙` denota multiplicação elemento a elemento.) A porta de esquecimento decide o que descartar da memória anterior; a porta de entrada decide quanto do conteúdo recém-proposto escrever; a porta de saída decide quanto da memória resultante de fato expor ao resto da rede neste passo de tempo.

### Por que isso corrige o gradiente que desaparece: um caminho (quase) aditivo

A escolha de projeto crítica é a própria equação de atualização da célula: `C_t = F_t⊙C_{t-1} + I_t⊙C̃_t` é uma **soma**, e não uma multiplicação repetida por uma matriz de pesos compartilhada, como era a atualização do estado oculto da RNN simples. Quando a porta de esquecimento `F_t` está perto de 1 (a rede aprendeu que esta informação deve ser mantida), o gradiente de `C_t` em relação a `C_{t-1}` também fica perto de 1; a célula de memória oferece um caminho ao longo do tempo em que o gradiente não é sistematicamente encolhido nem amplificado por multiplicação repetida de matrizes, em contraste nítido com o estado oculto da RNN simples, que é recalculado do zero (por uma multiplicação de matriz e uma não linearidade que achata os valores) a cada passo de tempo. Esse caminho aditivo, controlado por portas, é precisamente o motivo de as LSTMs conseguirem aprender dependências que se estendem por muito mais passos de tempo do que uma RNN simples consegue de forma confiável.

### GRU: um esquema de portas simplificado

A GRU funde as portas de esquecimento e de entrada em uma única **porta de atualização** e remove completamente a célula de memória separada, incorporando o papel dela diretamente ao estado oculto:

```text
Porta de atualização: Z_t = σ(W_z·[h_{t-1}, x_t] + b_z)
Porta de reset:       R_t = σ(W_r·[h_{t-1}, x_t] + b_r)
Candidato:            H̃_t = tanh(W_h·[R_t⊙h_{t-1}, x_t] + b_h)
Estado oculto:        H_t = Z_t⊙H_{t-1} + (1−Z_t)⊙H̃_t
```

A atualização do estado oculto da GRU é estruturalmente a mesma ideia da atualização da célula da LSTM (uma interpolação controlada por porta entre "manter o estado antigo" e "escrever conteúdo novo"), com menos parâmetros e uma porta a menos. Nenhuma das duas arquiteturas domina estritamente a outra na prática: a GRU é mais barata de treinar e muitas vezes tem desempenho comparável, enquanto a porta extra e a célula de memória separada da LSTM lhe dão um pouco mais de flexibilidade de representação, e a melhor escolha para uma tarefa específica costuma ser decidida empiricamente, e não por uma regra geral.

## Exemplos Resolvidos

### Exemplo 1: o fator de composição de uma RNN simples ao longo de 50 passos de tempo

Suponha que o fator de gradiente por passo de tempo de uma RNN simples (combinando `W_hh` e a derivada da tanh) seja normalmente `0.85`. Ao longo de 50 passos de tempo de distância:

```text
0.85^50 ≈ 0.000296   (cerca de 0,03%)
```

Um sinal de gradiente vindo de um loss 50 passos de tempo no futuro chega ao passo de tempo relevante mais antigo atenuado a cerca de três centésimos de um por cento do tamanho original; na prática, pequeno o bastante para que a rede não consiga aprender que aquele passo de tempo importava, por mais importante que ele fosse de fato para a saída correta.

### Exemplo 2: o gradiente quase preservado de uma LSTM com porta de esquecimento perto de 1

Suponha que uma LSTM tenha aprendido `F_t = 0.95` de forma consistente ao longo dos mesmos 50 passos de tempo (um valor razoável para informação que a rede aprendeu que vale a pena lembrar). O caminho de gradiente do estado da célula multiplica por `F_t` (e não por uma matriz de pesos completa e uma não linearidade) a cada passo:

```text
0.95^50 ≈ 0.077   (cerca de 7,7%)
```

Mesmo sem nenhuma correção adicional, um valor de porta perto de 1 (mas não exatamente 1) já preserva dramaticamente mais magnitude de gradiente ao longo de 50 passos de tempo (cerca de 7,7%) do que a multiplicação de matrizes composta da RNN simples (cerca de 0,03%); e quando a rede aprende `F_t` ainda mais perto de 1 para dependências genuinamente de longo alcance, essa preservação melhora ainda mais; é a versão concreta e numérica de por que o gating resolve um problema que o simples ajuste de pesos não resolvia.

## Equívocos Comuns e Armadilhas

- **"LSTM e GRU eliminam totalmente o problema do gradiente que desaparece."** Elas o mitigam bastante oferecendo um caminho aditivo, controlado por portas, para o estado de memória/oculto, mas sequências muito longas (centenas ou milhares de passos de tempo) ainda podem trazer dificuldade real; essa é uma das motivações práticas concretas, desenvolvida no próximo conceito, para a abordagem bem diferente do mecanismo de atenção, de não comprimir todo o histórico em um único estado recorrente.
- **"As três portas da LSTM são redes separadas com propósitos independentes."** As três portas são camadas pequenas, com parâmetros independentes, mas todas recebem as mesmas entradas (`h_{t-1}` e `x_t`) e determinam juntas uma única coisa: como a célula de memória é atualizada e exposta neste passo de tempo. Elas agem em conjunto, e não como três subsistemas sem relação.
- **"A GRU é simplesmente uma LSTM reduzida e estritamente pior."** A GRU remove uma porta e o estado de célula separado, mas não é uma aproximação estritamente pior; o projeto da sua porta de atualização é uma parametrização alternativa e pensada da mesma ideia central (memória com portas, majoritariamente aditiva), e frequentemente iguala o desempenho da LSTM com menos parâmetros para treinar.

## Resumo

O estado oculto de uma RNN simples é recalculado por multiplicação de matriz e uma não linearidade que achata os valores a cada passo de tempo, então os gradientes propagados para trás por muitos passos de tempo se compõem exponencialmente; o mesmo mecanismo de gradiente que desaparece/explode já diagnosticado para redes feedforward muito profundas, agora movido pelo comprimento da sequência. A LSTM trata isso com uma célula de memória separada, atualizada por uma soma (`F_t⊙C_{t-1} + I_t⊙C̃_t`) em vez de uma multiplicação de matriz repetida, controlada pelas portas de esquecimento, entrada e saída; quando a porta de esquecimento está perto de 1, o caminho do gradiente ao longo do tempo é quase preservado, em vez de se desfazer na composição. A GRU simplifica isso em uma única porta de atualização e sem estado de célula separado, trocando um pouco de flexibilidade de representação por menos parâmetros, sem que nenhuma das variantes domine estritamente a outra na prática.

## Documentation Links

- [Dive into Deep Learning: Long Short-Term Memory (LSTM)](https://d2l.ai/chapter_recurrent-modern/lstm.html): as equações das portas de esquecimento/entrada/saída e o mecanismo de "o gradiente consegue atravessar muitos passos de tempo sem desaparecer nem explodir" que este conceito deriva numericamente.
- [CS231n: Course Schedule (Stanford, Spring 2026)](https://cs231n.stanford.edu/schedule.html): confirma "RNN, LSTM, GRU" como o escopo real e combinado de uma aula, de acordo com o enquadramento deste conceito de LSTM/GRU como a correção direta da limitação da própria RNN simples.
