---
version: 1.0
updatedAt: 2026-08-13
title: "Teste por Tipo de Código: Os Quatro Quadrantes"
summary: "Um mapa de código de produção por complexidade/significância de domínio e número de colaboradores: onde o teste unitário compensa mais, onde é desperdício, e como o padrão Humble Object corrige o código que é genuinamente difícil de testar."
---
## Objective

Entender o mapa de quatro quadrantes de Khorikov para código de produção (por complexidade/significância de domínio e por número de colaboradores) e por que ele diz exatamente onde investir esforço de teste unitário, onde não se preocupar, e o que fazer com o código que é genuinamente difícil de testar.

## Use Cases

- Decidir se uma classe merece um teste unitário completo, um teste de integração leve, ou nenhum teste dedicado.
- Explicar por que "simplesmente adicione mais testes unitários" não corrige uma base de código em que as classes difíceis de testar são as que estão causando dor.
- Refatorar uma classe que mistura lógica de negócio com chamadas de banco de dados/HTTP em algo que de fato seja barato de testar.

## Deep Dive

### Dois eixos: complexidade/significância de domínio, e número de colaboradores

Todo pedaço de código de produção pode ser posicionado em dois eixos independentes. **Complexidade ou significância de domínio**: medida de forma aproximada pela complexidade ciclomática (pontos de ramificação) mais quão diretamente o código serve o domínio de negócio, em vez de ser encanamento. **Número de colaboradores**: quantas dependências mutáveis ou fora de processo uma classe precisa para sequer ser exercitada; valores imutáveis não contam, mas todo mock ou fake que você precisa montar conta.

### Os quatro quadrantes

```
                    Modelo de domínio,   Código
                    algoritmos           complicado demais
Complexidade/
significância
de domínio
                    Código trivial       Controllers

                              Número de colaboradores →
```

- **Modelo de domínio e algoritmos** (alta significância, poucos colaboradores): o ponto ideal. Testes de alto valor, e baratos: a lógica vale a pena proteger, e há pouco a preparar.
- **Código trivial** (baixa significância, poucos colaboradores): propriedades de uma linha, construtores sem parâmetros. Testá-lo não está errado, só é próximo de inútil; não há onde um bug se esconder.
- **Controllers** (baixa significância, muitos colaboradores): código que coordena outros componentes (classes de domínio, sistemas externos) sem fazer trabalho complexo por si só. Vale cobrir brevemente com um pequeno número de testes de integração, não uma suíte unitária exaustiva.
- **Código complicado demais** (alta significância, muitos colaboradores): o quadrante perigoso; importante demais para ficar sem teste, mas caro de testar unitariamente por causa de tudo o que precisa coordenar. É onde vive a maior parte da dor em bases de código "difíceis de testar unitariamente".

### A correção para código complicado demais: dividir

A regra prática: **quanto mais importante ou complexo o código, menos colaboradores ele deveria ter.** Código complicado demais chegou a esse ponto misturando lógica de negócio (que pertence ao quadrante de modelo de domínio) com coordenação de colaboradores (que pertence ao quadrante de controller) na mesma classe. Separar essas duas responsabilidades, puxando a tomada de decisão de fato para um método de domínio sem colaboradores, e deixando só a orquestração em um controller fino, move as duas metades para quadrantes mais baratos de testar, em vez de deixar um blob caro e arriscado no canto superior direito. Essa divisão é exatamente o que o **padrão Humble Object** formaliza: isolar a dependência difícil de testar (uma chamada de framework, I/O, threading) atrás de uma camada fina, deliberadamente "humilde", que não faz nada além de coordenar, para que a lógica que vale a pena testar nunca precise tocar essa dependência diretamente.

## Trade-offs

- **Testar unitariamente o quadrante de modelo de domínio dá o melhor retorno sobre esforço**: valioso porque a lógica importa, barato porque há pouco a preparar; é onde uma suíte de testes unitários deveria concentrar sua densidade.
- **Testar código trivial não está errado, só não vale a pena priorizar**: uma suíte perseguindo 100% de cobertura vai acabar com uma pilha de testes aqui que adicionam quase zero proteção enquanto ainda custam tempo de manutenção a cada mudança sem relação na forma daquela classe.
- **Controllers recebem teste de integração, não teste unitário exaustivo**: como o trabalho inteiro de um controller é coordenar colaboradores, um teste unitário dele isolado (mockando tudo) majoritariamente só redescreve a própria lógica de coordenação; um número menor de testes de integração contra colaboradores reais (ou próximos de reais) verifica a coisa que de fato importa, que a coordenação funciona.
- **Código complicado demais é um sinal para refatorar, não um sinal para escrever um teste maior**: jogar mais mocks e setup em uma classe do quadrante superior direito trata o sintoma; dividi-la via o padrão Humble Object em uma peça de algoritmo e uma peça de controller é o que de fato reduz tanto o risco quanto o custo de teste, e é a correção mais difícil e mais valiosa.
- **100% de cobertura nunca foi o objetivo**: uma suíte de testes em que todo teste agrega valor real, concentrada no quadrante de modelo de domínio, vence uma suíte que é maior mas está inflada com testes do quadrante trivial que contribuem quase nada.

## Documentation Links

- Vladimir Khorikov, *Unit Testing Principles, Practices, and Patterns* (Manning, 2020), Capítulo 7 "Refactoring Toward Valuable Unit Tests", "Identifying the Code to Refactor", pp. 152-155 (book)
- Gerard Meszaros, *xUnit Test Patterns: Refactoring Test Code* (Addison-Wesley, 2007), origem do padrão Humble Object (book)
